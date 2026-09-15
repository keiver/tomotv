/*
 * tvOS has no posix_spawn or fork, so libarchive's external-program filter is built with
 * no child launcher (build.sh passes HAVE_POSIX_SPAWNP=0 HAVE_FORK=0 HAVE_VFORK=0).
 * archive_read_support_filter_program.c still references these two helpers; answering
 * them with a failure keeps the link whole on every slice.
 */
#include <sys/types.h>
#include "archive.h"

int __archive_create_child(const char *cmd, int *child_stdin, int *child_stdout, pid_t *out_child) {
    (void)cmd; (void)child_stdin; (void)child_stdout; (void)out_child;
    return ARCHIVE_FAILED;
}

void __archive_check_child(int in, int out) {
    (void)in; (void)out;
}
