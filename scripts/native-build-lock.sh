# Source before touching native projects. The wrapper also handles nested calls.
if [ "${TOMOTV_NATIVE_BUILD_ENTRY:-}" != "$0" ]; then
  export TOMOTV_NATIVE_BUILD_ENTRY="$0"
  exec python3 scripts/native-build-lock.py bash "$0" "$@"
fi
unset TOMOTV_NATIVE_BUILD_ENTRY

native_build_unlock() {
  [[ "${TOMOTV_NATIVE_BUILD_LOCK_FD:-}" =~ ^[0-9]+$ ]] || return 1
  eval "exec ${TOMOTV_NATIVE_BUILD_LOCK_FD}>&-"
  unset TOMOTV_NATIVE_BUILD_LOCK_FD TOMOTV_NATIVE_BUILD_LOCK_ROOT
}
