/* SPDX-License-Identifier: GPL-2.0-or-later
 *
 * mupen64plus-input-pipe: drive N64 controller 1 from text commands written to a FIFO.
 *
 * The FIFO path comes from $M64P_INPUT_PIPE (default: $XDG_RUNTIME_DIR/mupen64plus-input,
 * falling back to /tmp/mupen64plus-input) and is created if it doesn't exist. One
 * newline-terminated command per line:
 *
 *   press BUTTONS [N]   hold BUTTONS for N polls (default 3), then release for 3 polls
 *   hold  BUTTONS [N]   hold BUTTONS for N polls (default 1), with no release afterwards
 *   wait  N             leave the controller neutral for N polls
 *   clear               drop every command still queued
 *
 * BUTTONS is any mix of A B Z L R START DU DD DL DR CU CD CL CR, separated by spaces or '+',
 * plus x=N / y=N for the analog stick (-128..127; a real stick reaches roughly +-80).
 * '#' starts a comment. Example:
 *
 *   printf 'press START\nwait 30\nhold A x=0 y=80 20\n' > "$M64P_INPUT_PIPE"
 *
 * Commands queue up and each lasts a fixed number of controller polls (most games poll once per
 * rendered frame), so a press can never be shorter than the game's polling interval. With nothing
 * queued the controller is neutral. "<fifo>.status" is rewritten when the queue fills or drains:
 * "busy polls=N", then "idle polls=N" once every queued poll has been delivered to the game.
 */

#include <errno.h>
#include <fcntl.h>
#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <strings.h>
#include <sys/stat.h>
#include <unistd.h>

#define M64P_PLUGIN_PROTOTYPES 1
#include "m64p_common.h"
#include "m64p_plugin.h"
#include "m64p_types.h"

#define PLUGIN_NAME         "Mupen64Plus Pipe Input Plugin"
#define PLUGIN_VERSION      0x020600
#define INPUT_API_VERSION   0x020101
#define VERSION_PRINTF_SPLIT(x) (((x) >> 16) & 0xffff), (((x) >> 8) & 0xff), ((x) & 0xff)

#define DEFAULT_PRESS_POLLS 3
#define QUEUE_SIZE          4096
#define LINE_MAX_LEN        1024

enum {
    BTN_A = 1 << 0, BTN_B = 1 << 1, BTN_Z = 1 << 2, BTN_L = 1 << 3, BTN_R = 1 << 4,
    BTN_START = 1 << 5,
    BTN_DU = 1 << 6, BTN_DD = 1 << 7, BTN_DL = 1 << 8, BTN_DR = 1 << 9,
    BTN_CU = 1 << 10, BTN_CD = 1 << 11, BTN_CL = 1 << 12, BTN_CR = 1 << 13,
};

static const struct { const char *name; unsigned mask; } button_names[] = {
    { "A", BTN_A }, { "B", BTN_B }, { "Z", BTN_Z }, { "L", BTN_L }, { "R", BTN_R },
    { "START", BTN_START },
    { "DU", BTN_DU }, { "DD", BTN_DD }, { "DL", BTN_DL }, { "DR", BTN_DR },
    { "CU", BTN_CU }, { "CD", BTN_CD }, { "CL", BTN_CL }, { "CR", BTN_CR },
};

struct step {
    unsigned buttons;
    int x, y;
    unsigned polls;     /* for l_Current: polls remaining */
};

static int l_PluginInit = 0;
static void (*l_DebugCallback)(void *, int, const char *) = NULL;
static void *l_DebugCallContext = NULL;

static char l_PipePath[4096];
static char l_StatusPath[sizeof(l_PipePath) + 8];
static int l_PipeFd = -1;
static int l_CreatedPipe = 0;

static char l_Line[LINE_MAX_LEN];
static size_t l_LineLen = 0;
static int l_LineTooLong = 0;

static struct step l_Queue[QUEUE_SIZE];
static unsigned l_QueueHead = 0;
static unsigned l_QueueLen = 0;
static struct step l_Current;
static unsigned long l_Polls = 0;
static int l_StatusBusy = -1;       /* busy/idle state last written to the status file */

static void DebugMessage(int level, const char *message, ...)
{
    char msgbuf[1024];
    va_list args;

    if (l_DebugCallback == NULL)
        return;

    va_start(args, message);
    vsnprintf(msgbuf, sizeof(msgbuf), message, args);
    va_end(args);

    (*l_DebugCallback)(l_DebugCallContext, level, msgbuf);
}

/* Replace the status file atomically so readers never see it half-written. */
static void WriteStatus(const char *text)
{
    char tmp[sizeof(l_StatusPath) + 4];
    FILE *f;

    snprintf(tmp, sizeof(tmp), "%s.tmp", l_StatusPath);
    f = fopen(tmp, "w");
    if (f == NULL)
        return;
    fputs(text, f);
    fclose(f);
    rename(tmp, l_StatusPath);
}

static void UpdateStatus(int force)
{
    char text[64];
    int busy = l_Current.polls > 0 || l_QueueLen > 0;

    if (!force && busy == l_StatusBusy)
        return;
    l_StatusBusy = busy;

    snprintf(text, sizeof(text), "%s polls=%lu\n", busy ? "busy" : "idle", l_Polls);
    WriteStatus(text);
}

static void ClearQueue(void)
{
    l_QueueHead = 0;
    l_QueueLen = 0;
    memset(&l_Current, 0, sizeof(l_Current));
}

static void Enqueue(const struct step *s)
{
    l_Queue[(l_QueueHead + l_QueueLen) % QUEUE_SIZE] = *s;
    l_QueueLen++;
}

static int ParseLong(const char *text, long min, long max, long *out)
{
    char *end;
    long value;

    errno = 0;
    value = strtol(text, &end, 10);
    if (errno != 0 || end == text || *end != '\0' || value < min || value > max)
        return 0;
    *out = value;
    return 1;
}

static void Reject(const char *command, const char *why, const char *token)
{
    DebugMessage(M64MSG_WARNING, "ignoring command '%s': %s%s%s%s", command, why,
                 token ? " '" : "", token ? token : "", token ? "'" : "");
}

static void ParseLine(const char *text)
{
    static const char delims[] = " \t\r+";
    char command[LINE_MAX_LEN], buf[LINE_MAX_LEN];
    char *verb, *tok, *save = NULL, *comment;
    struct step s = { 0, 0, 0, 0 };
    long count = 0, value;
    int has_input = 0;
    size_t i;

    snprintf(buf, sizeof(buf), "%s", text);
    comment = strchr(buf, '#');
    if (comment != NULL)
        *comment = '\0';
    snprintf(command, sizeof(command), "%s", buf);     /* untokenized copy for messages */

    verb = strtok_r(buf, delims, &save);
    if (verb == NULL)
        return;

    while ((tok = strtok_r(NULL, delims, &save)) != NULL)
    {
        if ((tok[0] == 'x' || tok[0] == 'X' || tok[0] == 'y' || tok[0] == 'Y') && tok[1] == '=')
        {
            if (!ParseLong(tok + 2, -128, 127, &value))
            {
                Reject(command, "stick value must be -128..127:", tok);
                return;
            }
            if (tok[0] == 'x' || tok[0] == 'X')
                s.x = (int) value;
            else
                s.y = (int) value;
            has_input = 1;
        }
        else if (tok[0] >= '0' && tok[0] <= '9')
        {
            if (!ParseLong(tok, 1, 1000000, &count))
            {
                Reject(command, "poll count must be 1..1000000:", tok);
                return;
            }
        }
        else
        {
            for (i = 0; i < sizeof(button_names) / sizeof(button_names[0]); i++)
                if (strcasecmp(tok, button_names[i].name) == 0)
                    break;
            if (i == sizeof(button_names) / sizeof(button_names[0]))
            {
                Reject(command, "unknown button", tok);
                return;
            }
            s.buttons |= button_names[i].mask;
            has_input = 1;
        }
    }

    if (strcasecmp(verb, "press") == 0 || strcasecmp(verb, "hold") == 0)
    {
        int press = (verb[0] == 'p' || verb[0] == 'P');
        struct step release = { 0, 0, 0, DEFAULT_PRESS_POLLS };

        if (!has_input)
        {
            Reject(command, "no buttons or stick position given", NULL);
            return;
        }
        if (l_QueueLen + (press ? 2 : 1) > QUEUE_SIZE)
        {
            Reject(command, "input queue is full", NULL);
            return;
        }
        s.polls = count > 0 ? (unsigned) count : (press ? DEFAULT_PRESS_POLLS : 1);
        Enqueue(&s);
        if (press)
            Enqueue(&release);
    }
    else if (strcasecmp(verb, "wait") == 0)
    {
        if (has_input)
        {
            Reject(command, "wait only takes a poll count", NULL);
            return;
        }
        if (l_QueueLen == QUEUE_SIZE)
        {
            Reject(command, "input queue is full", NULL);
            return;
        }
        s.polls = count > 0 ? (unsigned) count : 1;
        Enqueue(&s);
    }
    else if (strcasecmp(verb, "clear") == 0)
    {
        ClearQueue();
    }
    else
    {
        Reject(command, "unknown command", verb);
        return;
    }

    DebugMessage(M64MSG_VERBOSE, "queued '%s'", command);
}

static void PumpPipe(void)
{
    char buf[4096];
    ssize_t n, i;

    if (l_PipeFd < 0)
        return;

    while ((n = read(l_PipeFd, buf, sizeof(buf))) > 0)
    {
        for (i = 0; i < n; i++)
        {
            if (buf[i] == '\n')
            {
                l_Line[l_LineLen] = '\0';
                if (l_LineTooLong)
                    DebugMessage(M64MSG_WARNING, "ignoring command longer than %d characters", LINE_MAX_LEN - 1);
                else
                    ParseLine(l_Line);
                l_LineLen = 0;
                l_LineTooLong = 0;
            }
            else if (l_LineLen < sizeof(l_Line) - 1)
                l_Line[l_LineLen++] = buf[i];
            else
                l_LineTooLong = 1;
        }
    }

    if (n < 0 && errno != EAGAIN && errno != EWOULDBLOCK && errno != EINTR)
    {
        DebugMessage(M64MSG_ERROR, "reading '%s' failed, input disabled: %s", l_PipePath, strerror(errno));
        close(l_PipeFd);
        l_PipeFd = -1;
    }
}

static int OpenPipe(void)
{
    const char *path = getenv("M64P_INPUT_PIPE");
    const char *runtime_dir = getenv("XDG_RUNTIME_DIR");
    struct stat st;

    if (path != NULL && path[0] != '\0')
        snprintf(l_PipePath, sizeof(l_PipePath), "%s", path);
    else
        snprintf(l_PipePath, sizeof(l_PipePath), "%s/mupen64plus-input",
                 (runtime_dir != NULL && runtime_dir[0] != '\0') ? runtime_dir : "/tmp");
    snprintf(l_StatusPath, sizeof(l_StatusPath), "%s.status", l_PipePath);

    l_CreatedPipe = 0;
    if (stat(l_PipePath, &st) == 0)
    {
        if (!S_ISFIFO(st.st_mode))
        {
            DebugMessage(M64MSG_ERROR, "'%s' exists and is not a FIFO", l_PipePath);
            return 0;
        }
    }
    else if (mkfifo(l_PipePath, 0600) == 0)
    {
        l_CreatedPipe = 1;
    }
    else
    {
        DebugMessage(M64MSG_ERROR, "couldn't create FIFO '%s': %s", l_PipePath, strerror(errno));
        return 0;
    }

    /* Open read-write: holding a write end ourselves makes read() report "no data" rather than EOF
     * between writers, and lets writers open the FIFO without blocking while the plugin is loaded. */
    l_PipeFd = open(l_PipePath, O_RDWR | O_NONBLOCK | O_CLOEXEC);
    if (l_PipeFd < 0)
    {
        DebugMessage(M64MSG_ERROR, "couldn't open FIFO '%s': %s", l_PipePath, strerror(errno));
        if (l_CreatedPipe)
            unlink(l_PipePath);
        return 0;
    }

    DebugMessage(M64MSG_INFO, "reading controller commands from '%s'", l_PipePath);
    return 1;
}

static void SetButtons(BUTTONS *Keys, const struct step *s)
{
    Keys->A_BUTTON     = (s->buttons & BTN_A) != 0;
    Keys->B_BUTTON     = (s->buttons & BTN_B) != 0;
    Keys->Z_TRIG       = (s->buttons & BTN_Z) != 0;
    Keys->L_TRIG       = (s->buttons & BTN_L) != 0;
    Keys->R_TRIG       = (s->buttons & BTN_R) != 0;
    Keys->START_BUTTON = (s->buttons & BTN_START) != 0;
    Keys->U_DPAD       = (s->buttons & BTN_DU) != 0;
    Keys->D_DPAD       = (s->buttons & BTN_DD) != 0;
    Keys->L_DPAD       = (s->buttons & BTN_DL) != 0;
    Keys->R_DPAD       = (s->buttons & BTN_DR) != 0;
    Keys->U_CBUTTON    = (s->buttons & BTN_CU) != 0;
    Keys->D_CBUTTON    = (s->buttons & BTN_CD) != 0;
    Keys->L_CBUTTON    = (s->buttons & BTN_CL) != 0;
    Keys->R_CBUTTON    = (s->buttons & BTN_CR) != 0;
    Keys->X_AXIS       = s->x;
    Keys->Y_AXIS       = s->y;
}

/* Mupen64Plus plugin API */

EXPORT m64p_error CALL PluginStartup(m64p_dynlib_handle CoreLibHandle, void *Context,
                                     void (*DebugCallback)(void *, int, const char *))
{
    if (l_PluginInit)
        return M64ERR_ALREADY_INIT;

    l_DebugCallback = DebugCallback;
    l_DebugCallContext = Context;

    if (!OpenPipe())
        return M64ERR_FILES;

    ClearQueue();
    l_Polls = 0;
    UpdateStatus(1);

    l_PluginInit = 1;
    return M64ERR_SUCCESS;
}

EXPORT m64p_error CALL PluginShutdown(void)
{
    if (!l_PluginInit)
        return M64ERR_NOT_INIT;

    if (l_PipeFd >= 0)
        close(l_PipeFd);
    l_PipeFd = -1;
    if (l_CreatedPipe)
        unlink(l_PipePath);
    WriteStatus("stopped\n");

    l_DebugCallback = NULL;
    l_DebugCallContext = NULL;
    l_PluginInit = 0;
    return M64ERR_SUCCESS;
}

EXPORT m64p_error CALL PluginGetVersion(m64p_plugin_type *PluginType, int *PluginVersion, int *APIVersion,
                                        const char **PluginNamePtr, int *Capabilities)
{
    if (PluginType != NULL)
        *PluginType = M64PLUGIN_INPUT;
    if (PluginVersion != NULL)
        *PluginVersion = PLUGIN_VERSION;
    if (APIVersion != NULL)
        *APIVersion = INPUT_API_VERSION;
    if (PluginNamePtr != NULL)
        *PluginNamePtr = PLUGIN_NAME;
    if (Capabilities != NULL)
        *Capabilities = 0;
    return M64ERR_SUCCESS;
}

EXPORT void CALL InitiateControllers(CONTROL_INFO ControlInfo)
{
    int i;

    for (i = 0; i < 4; i++)
    {
        ControlInfo.Controls[i].Present = (i == 0);
        ControlInfo.Controls[i].RawData = 0;
        ControlInfo.Controls[i].Plugin = (i == 0) ? PLUGIN_MEMPAK : PLUGIN_NONE;
        ControlInfo.Controls[i].Type = CONT_TYPE_STANDARD;
    }

    DebugMessage(M64MSG_INFO, "%s version %i.%i.%i initialized; controller 1 plugged in.",
                 PLUGIN_NAME, VERSION_PRINTF_SPLIT(PLUGIN_VERSION));
}

EXPORT void CALL GetKeys(int Control, BUTTONS *Keys)
{
    Keys->Value = 0;
    if (Control != 0)
        return;

    PumpPipe();

    while (l_Current.polls == 0 && l_QueueLen > 0)
    {
        l_Current = l_Queue[l_QueueHead];
        l_QueueHead = (l_QueueHead + 1) % QUEUE_SIZE;
        l_QueueLen--;
    }

    if (l_Current.polls > 0)
    {
        SetButtons(Keys, &l_Current);
        l_Current.polls--;
    }

    l_Polls++;
    UpdateStatus(0);
}

EXPORT void CALL ControllerCommand(int Control, unsigned char *Command)
{
}

EXPORT void CALL ReadController(int Control, unsigned char *Command)
{
}

EXPORT int CALL RomOpen(void)
{
    ClearQueue();
    l_Polls = 0;
    UpdateStatus(1);
    return 1;
}

EXPORT void CALL RomClosed(void)
{
    ClearQueue();
    UpdateStatus(1);
}

EXPORT void CALL SDL_KeyDown(int keymod, int keysym)
{
}

EXPORT void CALL SDL_KeyUp(int keymod, int keysym)
{
}
