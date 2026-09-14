/* * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * * *
 *   Mupen64plus - screenshot.c                                            *
 *   Mupen64Plus homepage: https://mupen64plus.org/                        *
 *   Copyright (C) 2008 Richard42                                          *
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

#include <SDL.h>
#include <ctype.h>
#include <png.h>
#include <setjmp.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>


#define M64P_CORE_PROTOTYPES 1
#include "api/callbacks.h"
#include "api/m64p_config.h"
#include "api/m64p_types.h"
#include "main/main.h"
#include "main/rom.h"
#include "main/util.h"
#include "osal/files.h"
#include "osal/preproc.h"
#include "osd/osd.h"
#include "plugin/plugin.h"

/*********************************************************************************************************
* PNG support functions for writing screenshot files
*/

static void mupen_png_error(png_structp png_write, const char *message)
{
    DebugMessage(M64MSG_ERROR, "PNG Error: %s", message);
}

static void mupen_png_warn(png_structp png_write, const char *message)
{
    DebugMessage(M64MSG_WARNING, "PNG Warning: %s", message);
}

static void user_write_data(png_structp png_write, png_bytep data, png_size_t length)
{
    FILE *fPtr = (FILE *) png_get_io_ptr(png_write);
    if (fwrite(data, 1, length, fPtr) != length)
        DebugMessage(M64MSG_ERROR, "Failed to write %zi bytes to screenshot file.", length);
}

static void user_flush_data(png_structp png_write)
{
    FILE *fPtr = (FILE *) png_get_io_ptr(png_write);
    fflush(fPtr);
}

/*********************************************************************************************************
* Other Local (static) functions
*/

static int SaveRGBBufferToFile(const char *filename, const unsigned char *buf, int width, int height, int pitch)
{
    int i;

    // allocate PNG structures
    png_structp png_write = png_create_write_struct(PNG_LIBPNG_VER_STRING, NULL, mupen_png_error, mupen_png_warn);
    if (!png_write)
    {
        DebugMessage(M64MSG_ERROR, "Error creating PNG write struct.");
        return 1;
    }
    png_infop png_info = png_create_info_struct(png_write);
    if (!png_info)
    {
        png_destroy_write_struct(&png_write, (png_infopp)NULL);
        DebugMessage(M64MSG_ERROR, "Error creating PNG info struct.");
        return 2;
    }
    // Set the jumpback
    if (setjmp(png_jmpbuf(png_write)))
    {
        png_destroy_write_struct(&png_write, &png_info);
        DebugMessage(M64MSG_ERROR, "Error calling setjmp()");
        return 3;
    }
    // open the file to write
    FILE *savefile = osal_file_open(filename, "wb");
    if (savefile == NULL)
    {
        DebugMessage(M64MSG_ERROR, "Error opening '%s' to save screenshot.", filename);
        return 4;
    }
    // set function pointers in the PNG library, for write callbacks
    png_set_write_fn(png_write, (png_voidp) savefile, user_write_data, user_flush_data);
    // set the info
    png_set_IHDR(png_write, png_info, width, height, 8, PNG_COLOR_TYPE_RGB,
                 PNG_INTERLACE_NONE, PNG_COMPRESSION_TYPE_DEFAULT, PNG_FILTER_TYPE_DEFAULT);
    // allocate row pointers and scale each row to 24-bit color
    png_byte **row_pointers;
    row_pointers = (png_byte **) malloc(height * sizeof(png_bytep));
    for (i = 0; i < height; i++)
    {
        row_pointers[i] = (png_byte *) (buf + (height - 1 - i) * pitch);
    }
    // set the row pointers
    png_set_rows(png_write, png_info, row_pointers);
    // write the picture to disk
    png_write_png(png_write, png_info, 0, NULL);
    // free memory
    free(row_pointers);
    png_destroy_write_struct(&png_write, &png_info);
    // close file
    fclose(savefile);
    // all done
    return 0;
}

static int CurrentShotIndex;
static unsigned int RingVIs;        // VIs since the ROM was opened
static unsigned int RingSlot;       // ring file to overwrite next
static double RingNextDueMs;        // emulated time of the next ring screenshot

// ROM-specific base name for screenshot files: the lowercased header name, or the MD5 without one
static void GetScreenshotBaseName(char *ScreenshotFileName, size_t Size)
{
    char *pch;

    // if there are any characters in the ROM header name with the highest bit set,
    // we assume it's encoded in Shift-JIS character set, and translate it to UTF-8
    const unsigned char *pccNameChar = (unsigned char *) ROM_PARAMS.headername;
    while (*pccNameChar != 0)
    {
        if ((*pccNameChar & 0x80) == 0x80)
            break;
        pccNameChar++;
    }
    if (*pccNameChar == 0)
    {
        // generate the base name of the screenshot
        // add the ROM name and convert to lowercase
        if (ROM_PARAMS.headername[0] != 0)
        {
            strcpy(ScreenshotFileName, ROM_PARAMS.headername);
            for (pch = ScreenshotFileName; *pch != '\0'; pch++)
                *pch = tolower(*pch);
        }
        else
        {
            // fallback to using MD5 when there's no internal ROM name set
            strcpy(ScreenshotFileName, ROM_SETTINGS.MD5);
        }
    }
    else
    {
        ShiftJis2UTF8((unsigned char *) ROM_PARAMS.headername, (unsigned char *) ScreenshotFileName, Size);
    }

    // sanitize filename
    string_replace_chars(ScreenshotFileName, " :<>\"/\\|?*", '_');
}

// Path of FileName inside the screenshot directory, creating the default directory if needed
static char *GetScreenshotFilePath(const char *FileName)
{
    char *ScreenshotPath;

    const char *SshotDir = ConfigGetParamString(g_CoreConfig, "ScreenshotPath");
    if (SshotDir == NULL || *SshotDir == '\0')
    {
        // note the trick to avoid an allocation. we add a NUL character
        // instead of the separator, call mkdir, then add the separator
        ScreenshotPath = formatstr("%sscreenshot%c%s", ConfigGetUserDataPath(), '\0', FileName);
        if (ScreenshotPath == NULL)
            return NULL;
        osal_mkdirp(ScreenshotPath, 0700);
        ScreenshotPath[strlen(ScreenshotPath)] = OSAL_DIR_SEPARATORS[0];
        return ScreenshotPath;
    }
    return combinepath(SshotDir, FileName);
}

// Grab the back image from OpenGL by calling the video plugin; the caller frees the buffer
static unsigned char *ReadScreenRGB(int *width, int *height)
{
    // get the width and height
    *width = 640;
    *height = 480;
    gfx.readScreen(NULL, width, height, 0);

    // allocate memory for the image
    unsigned char *pucFrame = (unsigned char *) malloc(*width * *height * 3);
    if (pucFrame != NULL)
        gfx.readScreen(pucFrame, width, height, 0);
    return pucFrame;
}

static char *GetNextScreenshotPath(void)
{
    char *ScreenshotPath;
    char ScreenshotFileName[60 + 8 + 1];

    // leave room for the "-###.png" suffix
    GetScreenshotBaseName(ScreenshotFileName, sizeof(ScreenshotFileName) - 8);
    strcat(ScreenshotFileName, "-###.png");

    ScreenshotPath = GetScreenshotFilePath(ScreenshotFileName);
    if (ScreenshotPath == NULL)
        return NULL;

    // patch the number part of the name (the '###' part) until we find a free spot
    char *NumberPtr = ScreenshotPath + strlen(ScreenshotPath) - 7;
    for (; CurrentShotIndex < 1000; CurrentShotIndex++)
    {
        sprintf(NumberPtr, "%03i.png", CurrentShotIndex);
        FILE *pFile = osal_file_open(ScreenshotPath, "r");
        if (pFile == NULL)
            break;
        fclose(pFile);
    }

    if (CurrentShotIndex >= 1000)
    {
        DebugMessage(M64MSG_ERROR, "Can't save screenshot; folder already contains 1000 screenshots for this ROM");
        free(ScreenshotPath);
        return NULL;
    }
    CurrentShotIndex++;

    return ScreenshotPath;
}

/*********************************************************************************************************
* Global screenshot functions
*/

void ScreenshotRomOpen(void)
{
    CurrentShotIndex = 0;
    RingVIs = 0;
    RingSlot = 0;
    RingNextDueMs = 0;
}

void TakeScreenshot(int iFrameNumber)
{
    char *filename;
    int width, height;

    // look for an unused screenshot filename
    filename = GetNextScreenshotPath();
    if (filename == NULL)
    {
        StateChanged(M64CORE_SCREENSHOT_CAPTURED, 0);
        return;
    }

    unsigned char *pucFrame = ReadScreenRGB(&width, &height);
    if (pucFrame == NULL)
    {
        StateChanged(M64CORE_SCREENSHOT_CAPTURED, 0);
        free(filename);
        return;
    }

    // write the image to a PNG
    int rval = SaveRGBBufferToFile(filename, pucFrame, width, height, width * 3);
    // free the memory
    free(pucFrame);
    free(filename);
    // print message -- this allows developers to capture frames and use them in the regression test
    if (rval != 0)
    {
        StateChanged(M64CORE_SCREENSHOT_CAPTURED, 0);
    }
    else
    {
        main_message(M64MSG_INFO, OSD_BOTTOM_LEFT, "Captured screenshot for frame %i.", iFrameNumber);
        StateChanged(M64CORE_SCREENSHOT_CAPTURED, 1);
    }
}

// Called once per VI. Returns 1 when a ring screenshot is due, based on emulated time.
int ScreenshotRingTick(unsigned int RefreshRate)
{
    unsigned int VI = RingVIs++;
    int IntervalMs = ConfigGetParamInt(g_CoreConfig, "ScreenshotRingIntervalMs");

    if (RefreshRate == 0 || IntervalMs <= 0 || ConfigGetParamInt(g_CoreConfig, "ScreenshotRingSize") <= 0)
        return 0;

    double NowMs = VI * 1000.0 / RefreshRate;
    if (NowMs < RingNextDueMs)
        return 0;
    RingNextDueMs = NowMs + IntervalMs;
    return 1;
}

// Overwrite the next file of the screenshot ring, and <rom>-latest.png
void TakeRingScreenshot(int iFrameNumber)
{
    int RingSize = ConfigGetParamInt(g_CoreConfig, "ScreenshotRingSize");
    const char *SshotDir = ConfigGetParamString(g_CoreConfig, "ScreenshotPath");
    char BaseName[60 + 1], FileName[60 + 32];
    int width, height;

    if (RingSize <= 0)
        return;
    if (RingSlot >= (unsigned int) RingSize)
        RingSlot = 0;

    // unlike manual screenshots, create a configured directory that doesn't exist yet
    if (SshotDir != NULL && *SshotDir != '\0')
        osal_mkdirp(SshotDir, 0700);

    GetScreenshotBaseName(BaseName, sizeof(BaseName));
    snprintf(FileName, sizeof(FileName), "%s-ring-%04u.png", BaseName, RingSlot);
    char *SlotPath = GetScreenshotFilePath(FileName);
    snprintf(FileName, sizeof(FileName), "%s-latest.png", BaseName);
    char *LatestPath = GetScreenshotFilePath(FileName);
    snprintf(FileName, sizeof(FileName), "%s-ring.tmp", BaseName);
    char *TmpPath = GetScreenshotFilePath(FileName);
    unsigned char *pucFrame = ReadScreenRGB(&width, &height);

    // write under a temporary name and rename, so readers never see a partial PNG
    if (SlotPath != NULL && LatestPath != NULL && TmpPath != NULL && pucFrame != NULL &&
        SaveRGBBufferToFile(TmpPath, pucFrame, width, height, width * 3) == 0 && rename(TmpPath, SlotPath) == 0 &&
        SaveRGBBufferToFile(TmpPath, pucFrame, width, height, width * 3) == 0 && rename(TmpPath, LatestPath) == 0)
    {
        DebugMessage(M64MSG_VERBOSE, "Saved ring screenshot for frame %i to '%s'", iFrameNumber, SlotPath);
        RingSlot = (RingSlot + 1) % RingSize;
    }
    else
    {
        DebugMessage(M64MSG_WARNING, "Couldn't save ring screenshot for frame %i", iFrameNumber);
    }

    free(pucFrame);
    free(TmpPath);
    free(LatestPath);
    free(SlotPath);
}

