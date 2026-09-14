#ifndef M64P_DEBUGGER_DBG_BACKTRACE_H
#define M64P_DEBUGGER_DBG_BACKTRACE_H

#include <stdint.h>

#include "api/m64p_debugger.h"

#ifdef __cplusplus
extern "C" {
#endif

void debugger_backtrace_set_enabled(int enabled);
void debugger_backtrace_begin_instruction(uint32_t stack_pointer, int in_exception);
void debugger_backtrace_record_jump(uint32_t pc, uint32_t op, uint32_t target,
                                    uint32_t sp, uint32_t ra,
                                    const uint32_t arguments[4], int completed);
int debugger_backtrace_get(uint32_t current_pc,
                           m64p_dbg_backtrace_frame* frames, int capacity);

#ifdef __cplusplus
}
#endif

#endif /* M64P_DEBUGGER_DBG_BACKTRACE_H */
