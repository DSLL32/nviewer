#
# Mupen64Plus pipe input plugin. The command protocol is documented at the top of src/plugin.c.
#
#   make [PREFIX=path] [PLUGINDIR=path] [APIDIR=path] [DEBUG=1] [all|install|uninstall|clean]
#

PREFIX    ?= /usr/local
LIBDIR    ?= $(PREFIX)/lib
PLUGINDIR ?= $(LIBDIR)/mupen64plus
APIDIR    ?= ../../../mupen64plus-core/src/api

SRCDIR = ../../src
OBJDIR = _obj$(POSTFIX)
TARGET = mupen64plus-input-pipe$(POSTFIX).so

CC        = $(CROSS_COMPILE)gcc
INSTALL  ?= install
OPTFLAGS ?= -O2
WARNFLAGS ?= -Wall
CFLAGS  += $(OPTFLAGS) $(WARNFLAGS) -fPIC -fvisibility=hidden -D_GNU_SOURCE -I"$(APIDIR)"
LDFLAGS += -shared -Wl,--no-undefined

ifeq ($(DEBUG), 1)
  CFLAGS += -g
  INSTALL_STRIP_FLAG ?=
else
  INSTALL_STRIP_FLAG ?= -s
endif

ifeq ($(wildcard $(APIDIR)/m64p_plugin.h),)
  $(error Mupen64Plus API headers not found in '$(APIDIR)'; set APIDIR to mupen64plus-core/src/api)
endif

all: $(TARGET)

$(OBJDIR)/%.o: $(SRCDIR)/%.c $(wildcard $(APIDIR)/*.h)
	@mkdir -p $(OBJDIR)
	$(CC) $(CFLAGS) -c -o $@ $<

$(TARGET): $(OBJDIR)/plugin.o
	$(CC) $(CFLAGS) $(LDFLAGS) -o $@ $^

install: $(TARGET)
	$(INSTALL) -d "$(DESTDIR)$(PLUGINDIR)"
	$(INSTALL) -m 0644 $(INSTALL_STRIP_FLAG) $(TARGET) "$(DESTDIR)$(PLUGINDIR)"

uninstall:
	$(RM) "$(DESTDIR)$(PLUGINDIR)/$(TARGET)"

clean:
	$(RM) -r $(OBJDIR) $(TARGET)

rebuild: clean all

.PHONY: all install uninstall clean rebuild
