/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *   Mupen64plus-ui-console - debugger.c                                   *
 *   Mupen64Plus homepage: https://mupen64plus.org/                        *
 *   Copyright (C) 2014 Will Nayes                                         *
 *                                                                         *
 *   This program is free software; you can redistribute it and/or modify  *
 *   it under the terms of the GNU General Public License as published by  *
 *   the Free Software Foundation; either version 2 of the License, or     *
 *   (at your option) any later version.                                   *
 *                                                                         *
 *   This program is distributed in the hope that it will be useful,       *
 *   but WITHOUT ANY WARRANTY; without even the implied warranty of        *
 *   MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the         *
 *   GNU General Public License for more details.                          *
 *                                                                         *
 *   You should have received a copy of the GNU General Public License     *
 *   along with this program; if not, write to the                         *
 *   Free Software Foundation, Inc.,                                       *
 *   51 Franklin Street, Fifth Floor, Boston, MA 02110-1301, USA.          *
 * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * */

#include <stdarg.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdint.h>
#include <errno.h>
#ifndef _WIN32
#include <unistd.h>
#endif

#include "core_interface.h"
#include "debugger.h"

#include <SDL.h>

/*
 * Variables
 */

// General Purpose Register names
const char *register_names[] = {
    "$r0",
    "$at",
    "v0", "v1",
    "a0", "a1", "a2", "a3",
    "t0", "t1", "t2", "t3", "t4", "t5", "t6", "t7",
    "s0", "s1", "s2", "s3", "s4", "s5", "s6", "s7",
    "t8", "t9",
    "k0", "k1",
    "$gp",
    "$sp",
    "sB",
    "$ra"
};

// Holds the previous GPR values for comparison details.
long long int prev_reg_values[32];
char reg_ran_previously = 0;

// Used to wait for core response before requesting next command.
int debugger_loop_wait = 1;

// Where the console writes; NULL means stdout. See debugger_set_output().
static FILE *debugger_out = NULL;

// Flushes every write, so a reader of the output file sees each prompt as soon as it's printed.
static void dbg_printf(const char *fmt, ...)
{
    FILE *out = debugger_out != NULL ? debugger_out : stdout;
    va_list args;

    va_start(args, fmt);
    vfprintf(out, fmt, args);
    va_end(args);
    fflush(out);
}

int debugger_set_output(const char *path)
{
    FILE *f = fopen(path, "w");

    if (f == NULL)
        return 1;
    debugger_out = f;
    return 0;
}

// Read one command line, including its newline. Returns 0 at end of input.
static int read_command(char *buf, size_t size)
{
#ifdef _WIN32
    return fgets(buf, (int) size, stdin) != NULL;
#else
    // Use read() rather than fgets(): a thread blocked in fgets() holds stdin's lock, and exit()
    // waits for that lock while flushing streams, so the emulator couldn't quit until another
    // line arrived.
    size_t len = 0;
    char c;

    for (;;) {
        ssize_t n = read(STDIN_FILENO, &c, 1);
        if (n < 0 && errno == EINTR)
            continue;
        if (n <= 0) {
            if (len == 0)
                return 0;
            break;
        }
        if (len < size - 1)
            buf[len++] = c;
        if (c == '\n')
            break;
    }
    buf[len] = '\0';
    return 1;
#endif
}

// Counter indicating the number of DebugStep() calls we need to make yet.
static int debugger_steps_pending = 0;

// Keep track of the run state.
static int cur_run_state = 0;

// Shadow call-stack tracing is opt-in because it adds work to every interpreted jump.
static int backtrace_enabled = 0;

// Remember the current program counter.
static unsigned int cur_pc = 0;

// Keep track of breakpoints locally.
static m64p_breakpoint *breakpoints;
static int num_breakpoints = 0;

/*
 * Debugger callbacks.
 */
void dbg_frontend_init() {
    breakpoints = (m64p_breakpoint *) malloc(BREAKPOINTS_MAX_NUMBER * sizeof(m64p_breakpoint));
    backtrace_enabled = 0;
    dbg_printf("Debugger initialized.\n");
}

void dbg_frontend_update(unsigned int pc) {
    cur_pc = pc;
    if (!debugger_steps_pending) {
        dbg_printf("\nPC at 0x%08X.\n", pc);
        debugger_loop_wait = 0;
        cur_run_state = 0;
    }
    else {
        --debugger_steps_pending;
        debugger_step();
    }
}

void dbg_frontend_vi() {
    //dbg_printf("Debugger vertical int.\n");
}

/*
 * Debugger methods.
 */
int debugger_setup_callbacks() {
    m64p_error rval = (*DebugSetCallbacks)(dbg_frontend_init,
                                           dbg_frontend_update,
                                           dbg_frontend_vi);
    return rval != M64ERR_SUCCESS;
}

int debugger_set_run_state(int state) {
    m64p_error rval = (*DebugSetRunState)((m64p_dbg_runstate) state);
    return rval != M64ERR_SUCCESS;
}

int debugger_step() {
    m64p_error rval = (*DebugStep)();
    return rval != M64ERR_SUCCESS;
}

// Retrieve the program counter.
int debugger_get_prev_pc() {
    return (*DebugGetState)(M64P_DBG_PREVIOUS_PC);
}

int64_t debugger_read_64(unsigned int addr) {
    return (*DebugMemRead64)(addr);
}
int debugger_read_32(unsigned int addr) {
    return (*DebugMemRead32)(addr);
}
int debugger_read_16(unsigned int addr) {
    return (*DebugMemRead16)(addr);
}
int debugger_read_8(unsigned int addr) {
    return (*DebugMemRead8)(addr);
}

void debugger_write_64(unsigned int addr, unsigned long long value) {
    (*DebugMemWrite64)(addr, value);
}
void debugger_write_32(unsigned int addr, unsigned int value) {
    (*DebugMemWrite32)(addr, value);
}
void debugger_write_16(unsigned int addr, unsigned short value) {
    (*DebugMemWrite16)(addr, value);
}
void debugger_write_8(unsigned int addr, unsigned char value) {
    (*DebugMemWrite8)(addr, value);
}

int debugger_print_registers() {
    unsigned long long int *regs = (unsigned long long int *) (*DebugGetCPUDataPtr)(M64P_CPU_REG_REG);
    if (regs == NULL)
        return -1;

    dbg_printf("General Purpose Registers:\n");
    int i;
    const char *format_padded = "%4s %016llX ";
    const char *format_nopad = "%4s %16llX ";
    for (i = 0; i < 32; ++i) {
        char val_changed = reg_ran_previously && regs[i] != prev_reg_values[i];

        // Use bold font if the value has changed since last time.
        if (val_changed)
            dbg_printf("%c[1m", 27); // Bold on

        // Print the register value, no padding if it is all zeroes. 
        dbg_printf(regs[i] == 0 ? format_nopad : format_padded,
               register_names[i], regs[i]);

        // Unset bold.
        if (val_changed)
            dbg_printf("%c[0m", 27); // Bold off

        reg_ran_previously = 1;
        prev_reg_values[i] = regs[i];

        // Two registers per line.
        if (i % 2 != 0)
            dbg_printf("\n");
    }
    return 0;
}

static void debugger_print_backtrace(void)
{
    enum { MAX_BACKTRACE_FRAMES = 256 };
    m64p_dbg_backtrace_frame frames[MAX_BACKTRACE_FRAMES];
    int count;
    int i;

    if (DebugGetBacktrace == NULL || DebugSetBacktraceEnabled == NULL) {
        dbg_printf("Backtraces are not supported by this core.\n");
        return;
    }

    if (!backtrace_enabled) {
        dbg_printf("Backtrace tracing is disabled; use 'bt on' before running.\n");
        return;
    }

    count = (*DebugGetBacktrace)(frames, MAX_BACKTRACE_FRAMES);
    if (count <= 0) {
        dbg_printf("No backtrace is available.\n");
        return;
    }

    dbg_printf("Backtrace:\n");
    for (i = 0; i < count; ++i) {
        const m64p_dbg_backtrace_frame *frame = &frames[i];
        dbg_printf("#%-3d 0x%08x", i, frame->pc);
        if (frame->has_entry) {
            dbg_printf(" in 0x%08x%s $sp=%08x {%08x, %08x, %08x, %08x}",
                       frame->entry_pc, frame->tail ? " (tail)" : "       ",
                       frame->stack_pointer, frame->arguments[0],
                       frame->arguments[1], frame->arguments[2],
                       frame->arguments[3]);
        }
        dbg_printf("\n");
    }
}

static void debugger_print_execution_history(void)
{
    enum { HISTORY_SIZE = 256 };
    uint32_t pcs[HISTORY_SIZE];
    uint32_t instructions[HISTORY_SIZE];
    int count;
    int i;

    if (DebugGetExecutionHistory == NULL) {
        dbg_printf("Execution history is not supported by this core.\n");
        return;
    }

    count = (*DebugGetExecutionHistory)(pcs, instructions, HISTORY_SIZE);
    if (count <= 0) {
        dbg_printf("Execution history is empty.\n");
        return;
    }

    dbg_printf("Execution history (oldest to newest):\n");
    for (i = 0; i < count; ++i)
        dbg_printf("0x%08x: %08x\n", pcs[i], instructions[i]);
}

typedef enum {
    M64P_ASM_FLAG_INDEX = 0x01,
    M64P_ASM_FLAG_ADDR = 0x02,
    M64P_ASM_FLAG_BINARY = 0x04
} disassembly_flags;

/*
 * Debugger main loop
 */
int debugger_loop(void *arg) {
    char input[256];
    while (1) {
        if (debugger_loop_wait) {
            SDL_Delay(1);
            continue;
        }

        dbg_printf("(dbg) ");
        if (!read_command(input, sizeof(input))) {
            break;
        }
        input[strlen(input) - 1] = 0;

        if (strcmp(input, "run") == 0) {
            cur_run_state = 2;
            if (debugger_set_run_state(cur_run_state))
                dbg_printf("Error setting run_state: run\n");
            else {
                debugger_step(); // Hack to kick-start the emulation.
            }
        }
        else if (strcmp(input, "pause") == 0) {
            cur_run_state = 0;
            if (debugger_set_run_state(cur_run_state))
                dbg_printf("Error setting run_state: pause\n");
        }
        else if (strncmp(input, "step", 4) == 0) {
            if (cur_run_state == 2) {
              dbg_printf("Cannot step while running. Type `pause' first.\n");
              continue;
            }

            debugger_loop_wait = 1;
            debugger_steps_pending = 1;
            sscanf(input, "step %d", &debugger_steps_pending);
            if (debugger_steps_pending < 1)
                debugger_steps_pending = 1;
            --debugger_steps_pending;
            debugger_step();
        }
        else if (strcmp(input, "regs") == 0) {
            debugger_print_registers();
        }
        else if (strcmp(input, "pc") == 0) {
            dbg_printf("PC: %08X\n", cur_pc);
        }
        else if (strcmp(input, "pc-1") == 0) {
            dbg_printf("Previous PC: %08X\n", debugger_get_prev_pc());
        }
        else if (strcmp(input, "bt on") == 0) {
            m64p_error rval;
            if (DebugSetBacktraceEnabled == NULL || DebugGetBacktrace == NULL) {
                dbg_printf("Backtraces are not supported by this core.\n");
                continue;
            }
            rval = (*DebugSetBacktraceEnabled)(1);
            if (rval != M64ERR_SUCCESS) {
                dbg_printf("Could not enable backtraces: %s\n", (*CoreErrorMessage)(rval));
            } else {
                backtrace_enabled = 1;
                dbg_printf("Backtrace tracing enabled; existing trace state was cleared.\n");
            }
        }
        else if (strcmp(input, "bt off") == 0) {
            m64p_error rval;
            if (DebugSetBacktraceEnabled == NULL) {
                dbg_printf("Backtraces are not supported by this core.\n");
                continue;
            }
            rval = (*DebugSetBacktraceEnabled)(0);
            if (rval != M64ERR_SUCCESS) {
                dbg_printf("Could not disable backtraces: %s\n", (*CoreErrorMessage)(rval));
            } else {
                backtrace_enabled = 0;
                dbg_printf("Backtrace tracing disabled.\n");
            }
        }
        else if (strcmp(input, "bt") == 0) {
            debugger_print_backtrace();
        }
        else if (strcmp(input, "history") == 0) {
            debugger_print_execution_history();
        }
        else if (strcmp(input, "visited reset") == 0) {
            m64p_error rval;
            if (DebugResetVisitedRDRAM == NULL) {
                dbg_printf("RDRAM execution coverage is not supported by this core.\n");
                continue;
            }
            rval = (*DebugResetVisitedRDRAM)();
            if (rval != M64ERR_SUCCESS)
                dbg_printf("Could not reset RDRAM execution coverage: %s\n",
                           (*CoreErrorMessage)(rval));
            else
                dbg_printf("RDRAM execution coverage reset.\n");
        }
        else if (strcmp(input, "visited break") == 0) {
            int enabled;
            m64p_error rval;
            if (DebugSetBreakOnUnvisited == NULL ||
                DebugGetBreakOnUnvisited == NULL) {
                dbg_printf("RDRAM execution coverage is not supported by this core.\n");
                continue;
            }
            enabled = !(*DebugGetBreakOnUnvisited)();
            rval = (*DebugSetBreakOnUnvisited)(enabled);
            if (rval != M64ERR_SUCCESS)
                dbg_printf("Could not change unvisited-code breaking: %s\n",
                           (*CoreErrorMessage)(rval));
            else
                dbg_printf("Break on unvisited RDRAM code %s.\n",
                           enabled ? "enabled" : "disabled");
        }
        else if (strncmp(input, "asm", 3) == 0) {
            // simple linear sweep disassembly
            uint32_t addr = cur_pc, size=1, flags=0;

            uint32_t lookupAddr, lookupData;
            char op[64];
            char args[64];

            if (sscanf(input, "asm %i %i %i", &addr, &size, &flags) == 3) {
            } else if (sscanf(input, "asm %i %i", &addr, &size) == 2) {
            } else if (sscanf(input, "asm %i", &addr) == 1) {
            } else if (strcmp(input, "asm") == 0) {
            } else {
                dbg_printf("Improperly formatted disassembly command: '%s'\n", input);
                continue;
            }
            addr &= ~0x03; // align to 4 byte boundary
            dbg_printf("Disassembly of %d instruction%s @ 0x%08x:\n", size, (size == 1 ? "" : "s"), addr);
            for (uint32_t i = 0; i < size; i++) {
                lookupAddr = addr + (i * 4);
                lookupData = debugger_read_32(lookupAddr);
                (*DebugDecodeOp)(lookupData, op, args, lookupAddr);
                if (flags & M64P_ASM_FLAG_INDEX) { // 0x01
                    dbg_printf("% 3d ", i);
                }
                if (flags & M64P_ASM_FLAG_ADDR) { // 0x02
                    dbg_printf("%08x ", lookupAddr);
                }
                if (flags & M64P_ASM_FLAG_BINARY) { // 0x04
                    dbg_printf("[%08x] ", lookupData);
                }
                dbg_printf("%s %s\n", op, args);
            }
        }
        else if (strncmp(input, "mem", 3) == 0) {
            uint32_t readAddr, length=1, rows=1, size=4;
            uint32_t i, j;
            char chSize;
            if ((sscanf(input, "mem /%ux%u%c %x", &rows, &length, &chSize, &readAddr) == 4 ||
                 sscanf(input, "mem /%ux%u%c %u", &rows, &length, &chSize, &readAddr) == 4)
                && (chSize == 'b' || chSize == 'h' || chSize == 'w' || chSize == 'd'))
            {
                if (chSize == 'b')
                    size = 1;
                else if (chSize == 'h')
                    size = 2;
                else if (chSize == 'w')
                    size = 4;
                else // chSize == 'd'
                    size = 8;
            }
            else if (sscanf(input, "mem /%ux%u %x", &rows, &length, &readAddr) == 3 ||
                     sscanf(input, "mem /%ux%u %u", &rows, &length, &readAddr) == 3)
            {
            }
            else if ((sscanf(input, "mem /%u%c %x", &length, &chSize, &readAddr) == 3 ||
                      sscanf(input, "mem /%u%c %u", &length, &chSize, &readAddr) == 3) 
                     && (chSize == 'b' || chSize == 'h' || chSize == 'w' || chSize == 'd'))
            {
                rows = 1;
                if (chSize == 'b')
                    size = 1;
                else if (chSize == 'h')
                    size = 2;
                else if (chSize == 'w')
                    size = 4;
                else // chSize == 'd'
                    size = 8;
            }
            else if (sscanf(input, "mem /%u %x", &length, &readAddr) == 2 ||
                     sscanf(input, "mem /%u %u", &length, &readAddr) == 2)
            {
                rows = 1;
            }
            else if (sscanf(input, "mem %x", &readAddr) == 1 ||
                     sscanf(input, "mem %u", &readAddr) == 1)
            {
                rows = 1;
                length = 1;
            }
            else
            {
                dbg_printf("Improperly formatted memory read command: '%s'\n", input);
                continue;
            }
            for (i = 0; i < rows; i++)
            {
                for (j = 0; j < length; j++)
                {
                    uint32_t thisAddr = readAddr + ((i * length) + j) * size;
                    switch(size)
                    {
                        case 1:
                            dbg_printf("%02x ", debugger_read_8(thisAddr));
                            break;
                        case 2:
                            dbg_printf("%04x ", debugger_read_16(thisAddr));
                            break;
                        case 4:
                            dbg_printf("%08x ", debugger_read_32(thisAddr));
                            break;
                        case 8:
                            dbg_printf("%016llx ", (long long unsigned int) debugger_read_64(thisAddr));
                            break;
                    }
                }
                dbg_printf("\n");
            }
        }
        else if (strncmp(input, "dumpmem", 7) == 0) {
            uint32_t addr;
            uint32_t len;
            char filename[64];

            uint8_t *membase;
            FILE *f;

            if (sscanf(input, "dumpmem %x 0x%x %63s", &addr, &len, filename) != 3 &&
                sscanf(input, "dumpmem %x %u %63s",   &addr, &len, filename) != 3) {
                dbg_printf("Improperly formatted dumpmem command: '%s'\n", input);
                continue;
            }

            filename[sizeof(filename) - 1] = '\0';

            addr = (*DebugVirtualToPhysical)(addr);
            if (addr >= 0x800000) {
                dbg_printf("Requested address must be within RDRAM region\n");
                continue;
            }

            // 8 MB is the upper limit
            if (len > 0x800000 - addr)
                len = 0x800000 - addr;

            membase = (*DebugMemGetPointer)(M64P_DBG_PTR_RDRAM);

            f = fopen(filename, "wb");
            if (f == NULL) {
                dbg_printf("Could not open file '%s' for write\n", filename);
                continue;
            }

            // RDRAM is kept as 32-bit words in host byte order; write it in the N64's big-endian order.
            const uint32_t *words = (const uint32_t *) membase;
            uint8_t buf[4096];
            size_t n = 0;
            for (uint32_t o = addr; o < addr + len; o++) {
                buf[n++] = (uint8_t) (words[o >> 2] >> (24 - 8 * (o & 3)));
                if (n == sizeof(buf)) {
                    fwrite(buf, 1, n, f);
                    n = 0;
                }
            }
            fwrite(buf, 1, n, f);

            fclose(f);

            dbg_printf("Dumped 0x%08x bytes starting at 0x%08x to %s (big-endian)\n",
                len, addr, filename);
        }
        else if (strncmp(input, "translate", 9) == 0) {
            uint32_t virt_addr, phys_addr;
            if (sscanf(input, "translate %i", &virt_addr) == 1) {
            } else {
                dbg_printf("Improperly formatted translate command: '%s'\n", input);
                continue;
            }
            phys_addr = (*DebugVirtualToPhysical)(virt_addr);
            dbg_printf("virtual 0x%08x -> physical 0x%08x\n", virt_addr, phys_addr);
        }
        else if (strncmp(input, "write", 5) == 0) {
            uint32_t writeAddr, size=1;
            long long unsigned int writeVal;
            char chSize;
            if (sscanf(input, "write %i %c %llx", &writeAddr, &chSize, &writeVal) == 3 &&
                (chSize == 'b' || chSize == 'h' || chSize == 'w' || chSize == 'd')) {
                if (chSize == 'b') {
                    size = 1;
                } else if (chSize == 'h') {
                    size = 2;
                } else if (chSize == 'w') {
                    size = 4;
                } else {
                    size = 8;
                }
            } else if (sscanf(input, "write %i %llx", &writeAddr, &writeVal) == 2) {
            } else {
                dbg_printf("Improperly formatted memory write command: '%s'\n", input);
                continue;
            }

            switch(size) {
                case 1:
                    debugger_write_8(writeAddr, (unsigned char)writeVal);
                    dbg_printf("0x%08x <- 0x%02x\n", writeAddr, (unsigned char)writeVal);
                    break;
                case 2:
                    debugger_write_16(writeAddr, (unsigned short)writeVal);
                    dbg_printf("0x%08x <- 0x%04x\n", writeAddr, (unsigned short)writeVal);
                    break;
                case 4:
                    debugger_write_32(writeAddr, (unsigned int)writeVal);
                    dbg_printf("0x%08x <- 0x%08x\n", writeAddr, (unsigned int)writeVal);
                    break;
                case 8:
                    debugger_write_64(writeAddr, writeVal);
                    dbg_printf("0x%08x <- 0x%016llx\n", writeAddr, writeVal);
                    break;
            }
        }
        else if (strcmp(input, "bp list") == 0 || strcmp(input, "bp ls") == 0) {
            if (num_breakpoints == 0) {
                dbg_printf("No breakpoints added. Add with 'bp add 0x...'\n");
                continue;
            }

            dbg_printf("Breakpoints:\n");
            int i;
            unsigned int flags;
            for (i = 0; i < num_breakpoints; i++) {
                flags = breakpoints[i].flags;
                if (breakpoints[i].address == breakpoints[i].endaddr) {
                    dbg_printf("[%d] 0x%08X [%c%c%c]",
                           i, breakpoints[i].address,
                           flags & M64P_BKP_FLAG_READ ? 'R' : ' ',
                           flags & M64P_BKP_FLAG_WRITE ? 'W' : ' ',
                           flags & M64P_BKP_FLAG_EXEC ? 'X' : ' ');
                } else {
                    dbg_printf("[%d] 0x%08X - 0x%08X [%c%c%c]",
                           i, breakpoints[i].address, breakpoints[i].endaddr,
                           flags & M64P_BKP_FLAG_READ ? 'R' : ' ',
                           flags & M64P_BKP_FLAG_WRITE ? 'W' : ' ',
                           flags & M64P_BKP_FLAG_EXEC ? 'X' : ' ');
                }

                if ((breakpoints[i].flags & M64P_BKP_FLAG_ENABLED) == 0)
                    dbg_printf(" (Disabled)");
                dbg_printf("\n");
            }
        }
        else if (strncmp(input, "bp add ", 7) == 0) {
            uint32_t addr, size = 0, flags = M64P_BKP_FLAG_READ |
                                             M64P_BKP_FLAG_WRITE |
                                             M64P_BKP_FLAG_EXEC;
            if (strcmp(input, "bp add pc") == 0) {
                addr = cur_pc;
            } else if (sscanf(input, "bp add %i %i %i", &addr, &size, &flags) == 3) {
            } else if (sscanf(input, "bp add %i %i", &addr, &size) == 2) {
            } else if (sscanf(input, "bp add %i", &addr) == 1) {
            } else {
                dbg_printf("Improperly formatted breakpoint add command: '%s'\n", input);
                continue;
            }

            if (addr == 0) {
                dbg_printf("Invalid breakpoint address.\n");
                continue;
            }

            m64p_breakpoint bkpt;
            bkpt.address = addr;
            bkpt.endaddr = addr + size;
            bkpt.flags = M64P_BKP_FLAG_ENABLED |
                         flags |
                         M64P_BKP_FLAG_LOG;
            int numBkps =
                (*DebugBreakpointCommand)(M64P_BKP_CMD_ADD_STRUCT, 0, &bkpt);
            if (numBkps == -1) {
                dbg_printf("Maximum breakpoint limit already reached.\n");
                continue;
            }

            breakpoints[num_breakpoints] = bkpt;
            num_breakpoints++;
            if (size > 0) {
                dbg_printf("Added breakpoint at range [0x%08X to 0x%08X].\n", addr, addr + size);
            } else {
                dbg_printf("Added breakpoint at 0x%08X.\n", addr);
            }

            if (flags & (M64P_BKP_FLAG_READ | M64P_BKP_FLAG_WRITE)) {
                // setting a memory read/write breakpoint -- warn if physical address differs from the user input
                uint32_t phys_addr = (*DebugVirtualToPhysical)(addr);
                if (phys_addr != 0 && addr != phys_addr) {
                    dbg_printf("Warning: Physical address %08x != virtual address %08x for memory read/write breakpoint.\n",
                            phys_addr, addr);
                }
            }
        }
        else if (strncmp(input, "bp trig", 7) == 0) {
            uint32_t flags, addr;
            (*DebugBreakpointTriggeredBy)(&flags, &addr);

            if (flags != 0) {
                dbg_printf("Breakpoint @ PC 0x%08x triggered on 0x%08x [%c%c%c]\n",
                       cur_pc, addr,
                       flags & M64P_BKP_FLAG_READ ? 'R' : ' ',
                       flags & M64P_BKP_FLAG_WRITE ? 'W' : ' ',
                       flags & M64P_BKP_FLAG_EXEC ? 'X' : ' ');
            }
        }
        else if (strncmp(input, "bp rm ", 6) == 0) {
            int index = -1;
            unsigned int addr = 0;
            if (strncmp(input, "bp rm 0x", 8) == 0) {
                sscanf(input, "bp rm 0x%X", &addr);
                if (addr == 0)
                    sscanf(input, "bp rm 0x%x", &addr);

                int i;
                for (i = 0; i < num_breakpoints; i++) {
                    if (breakpoints[i].address == addr)
                        index = i;
                }
            }
            else {
                sscanf(input, "bp rm %d", &index);
                if (index >= 0 && index < num_breakpoints)
                    addr = breakpoints[index].address;
            }

            if (index == -1 || addr == 0) {
                dbg_printf("Invalid value passed. ");
                dbg_printf("Pass an address or breakpoint number.\n");
                continue;
            }

            (*DebugBreakpointCommand)(M64P_BKP_CMD_REMOVE_IDX, index, NULL);
            num_breakpoints--;
            dbg_printf("Breakpoint [%d] 0x%08X removed.\n", index, addr);

            // Shift the array elements ahead of index down.
            int j;
            for (j = index + 1; j < num_breakpoints; j++) {
                breakpoints[j - 1] = breakpoints[j];
            }

        }
        else if (strcmp(input, "exit") == 0 || strcmp(input, "quit") == 0) {
            (*CoreDoCommand)(M64CMD_STOP, 0, NULL);
            break;
        }
        else if (strlen(input) == 0)
            continue;
        else
            dbg_printf("Unrecognized: %s\n", input);
    }

    return -1;
}
