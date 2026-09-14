#include "dbg_backtrace.h"

#include <cstddef>
#include <cstdint>
#include <unordered_map>
#include <utility>
#include <vector>

namespace {

constexpr std::size_t MaxDepth = 256;

enum class FrameKind : uint8_t
{
    Root,
    Call,
    TailCall,
};

struct CallFrame
{
    FrameKind kind = FrameKind::Root;
    uint32_t source_pc = 0;
    uint32_t entry_pc = 0;
    uint32_t return_pc = 0;
    uint32_t entry_sp = 0;
    uint32_t arguments[4] = {};
    bool captured_entry = false;
};

struct ShadowStack
{
    std::vector<CallFrame> frames;

    void reset()
    {
        frames.clear();
        frames.reserve(32);
        frames.emplace_back();
    }
};

class BacktraceTracker
{
public:
    void set_enabled(bool enabled)
    {
        enabled_ = enabled;
        in_exception_ = false;
        have_active_thread_ = false;
        active_thread_.frames.clear();
        isr_.frames.clear();
        suspended_threads_.clear();
    }

    void begin_instruction(uint32_t sp, bool in_exception)
    {
        if (!enabled_)
            return;

        if (in_exception) {
            if (!in_exception_) {
                if (have_active_thread_)
                    suspended_threads_[sp] = std::move(active_thread_);
                isr_.reset();
            }
            in_exception_ = true;
            return;
        }

        if (in_exception_ || !have_active_thread_) {
            isr_.frames.clear();
            const auto suspended = suspended_threads_.find(sp);
            if (suspended != suspended_threads_.end()) {
                active_thread_ = std::move(suspended->second);
                suspended_threads_.erase(suspended);
            } else {
                active_thread_.reset();
            }
            have_active_thread_ = true;
        }
        in_exception_ = false;
    }

    void record_jump(uint32_t pc, uint32_t op, uint32_t target,
                     uint32_t sp, uint32_t ra, const uint32_t arguments[4],
                     bool completed)
    {
        if (!enabled_ || !completed)
            return;

        ShadowStack* stack = current_stack();
        if (stack == nullptr)
            return;

        const unsigned int opcode = op >> 26;
        if (opcode == 3) {
            push(*stack, FrameKind::Call, pc, target, pc + 8, sp, arguments);
            return;
        }
        if (opcode == 2) {
            push_tail_if_plausible(*stack, pc, target, sp, ra, arguments);
            return;
        }
        if (opcode != 0)
            return;

        const unsigned int function = op & 0x3f;
        const unsigned int rs = (op >> 21) & 0x1f;
        const unsigned int rd = (op >> 11) & 0x1f;
        if (function == 9 && rd == 31) {
            push(*stack, FrameKind::Call, pc, target, pc + 8, sp, arguments);
        } else if (function == 8 && rs == 31) {
            pop_return(*stack, target, sp);
        } else if (function == 8) {
            push_tail_if_plausible(*stack, pc, target, sp, ra, arguments);
        }
    }

    int get(uint32_t current_pc, m64p_dbg_backtrace_frame* output,
            int capacity) const
    {
        if (!enabled_ || output == nullptr || capacity <= 0)
            return 0;

        const ShadowStack* stack = current_stack();
        if (stack == nullptr || stack->frames.empty()) {
            output[0] = {};
            output[0].pc = current_pc;
            return 1;
        }

        int count = 0;
        for (std::size_t index = stack->frames.size(); index != 0 && count < capacity;
             --index) {
            const CallFrame& frame = stack->frames[index - 1];
            m64p_dbg_backtrace_frame& result = output[count++];
            const bool is_current = index == stack->frames.size();

            result.pc = is_current ? current_pc : stack->frames[index].source_pc;
            result.entry_pc = frame.entry_pc;
            result.stack_pointer = frame.entry_sp;
            for (unsigned int arg = 0; arg != 4; ++arg)
                result.arguments[arg] = frame.arguments[arg];
            result.has_entry = frame.captured_entry ? 1 : 0;
            result.tail = !is_current &&
                stack->frames[index].kind == FrameKind::TailCall ? 1 : 0;
        }
        return count;
    }

private:
    ShadowStack* current_stack()
    {
        if (in_exception_)
            return isr_.frames.empty() ? nullptr : &isr_;
        return have_active_thread_ && !active_thread_.frames.empty()
            ? &active_thread_
            : nullptr;
    }

    const ShadowStack* current_stack() const
    {
        if (in_exception_)
            return isr_.frames.empty() ? nullptr : &isr_;
        return have_active_thread_ && !active_thread_.frames.empty()
            ? &active_thread_
            : nullptr;
    }

    static void push(ShadowStack& stack, FrameKind kind, uint32_t source_pc,
                     uint32_t entry_pc, uint32_t return_pc, uint32_t entry_sp,
                     const uint32_t arguments[4])
    {
        if (stack.frames.size() == MaxDepth)
            stack.frames.erase(stack.frames.begin());

        CallFrame frame;
        frame.kind = kind;
        frame.source_pc = source_pc;
        frame.entry_pc = entry_pc;
        frame.return_pc = return_pc;
        frame.entry_sp = entry_sp;
        for (unsigned int arg = 0; arg != 4; ++arg)
            frame.arguments[arg] = arguments[arg];
        frame.captured_entry = true;
        stack.frames.push_back(frame);
    }

    static void push_tail_if_plausible(ShadowStack& stack, uint32_t source_pc,
                                       uint32_t entry_pc, uint32_t sp, uint32_t ra,
                                       const uint32_t arguments[4])
    {
        const CallFrame& current = stack.frames.back();
        if (!current.captured_entry || current.entry_sp != sp ||
            current.return_pc != ra)
            return;

        // A frameless internal jump loop is indistinguishable from a cycle of
        // tail calls by register state alone. Collapse back to an entry already
        // represented by this return context rather than filling the trace with
        // repetitions of the cycle.
        for (std::size_t index = stack.frames.size(); index != 0; --index) {
            const CallFrame& previous = stack.frames[index - 1];
            if (previous.captured_entry && previous.entry_pc == entry_pc &&
                previous.entry_sp == sp && previous.return_pc == ra) {
                stack.frames.resize(index);
                return;
            }
        }

        push(stack, FrameKind::TailCall, source_pc, entry_pc,
             current.return_pc, sp, arguments);
    }

    static void pop_return(ShadowStack& stack, uint32_t target, uint32_t sp)
    {
        while (stack.frames.size() > 1) {
            const CallFrame& current = stack.frames.back();
            if (current.return_pc == target && current.entry_sp == sp) {
                const bool tail = current.kind == FrameKind::TailCall;
                stack.frames.pop_back();
                if (!tail)
                    return;
                continue;
            }

            // A non-local unwind may skip frames. Remove through the nearest
            // frame whose saved return state matches the observed return.
            for (std::size_t index = stack.frames.size() - 1; index != 0; --index) {
                const CallFrame& candidate = stack.frames[index];
                if (candidate.return_pc == target && candidate.entry_sp == sp) {
                    stack.frames.resize(index);
                    return;
                }
            }
            return;
        }
    }

    bool enabled_ = false;
    bool in_exception_ = false;
    bool have_active_thread_ = false;
    ShadowStack active_thread_;
    ShadowStack isr_;
    std::unordered_map<uint32_t, ShadowStack> suspended_threads_;
};

BacktraceTracker tracker;

} // namespace

extern "C" void debugger_backtrace_set_enabled(int enabled)
{
    tracker.set_enabled(enabled != 0);
}

extern "C" void debugger_backtrace_begin_instruction(uint32_t stack_pointer,
                                                       int in_exception)
{
    tracker.begin_instruction(stack_pointer, in_exception != 0);
}

extern "C" void debugger_backtrace_record_jump(uint32_t pc, uint32_t op,
                                                uint32_t target, uint32_t sp,
                                                uint32_t ra,
                                                const uint32_t arguments[4],
                                                int completed)
{
    tracker.record_jump(pc, op, target, sp, ra, arguments, completed != 0);
}

extern "C" int debugger_backtrace_get(uint32_t current_pc,
                                       m64p_dbg_backtrace_frame* frames,
                                       int capacity)
{
    return tracker.get(current_pc, frames, capacity);
}
