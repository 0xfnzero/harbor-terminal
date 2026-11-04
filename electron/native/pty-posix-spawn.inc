// Harbor fix for node-pty 1.1.0: release every temporary descriptor, including
// on failure. Keep ownership of only the master returned to the JS socket.
static void
pty_posix_spawn(char** argv, char** env,
                const struct termios *termp,
                const struct winsize *winp,
                int* master,
                pid_t* pid,
                int* err) {
  struct OwnedFd {
    int fd = -1;
    ~OwnedFd() { if (fd >= 0) close(fd); }
  } low[3], master_fd, slave_fd;
  *master = -1;
  *err = 0;
  // Reserve closed stdio slots without allocating extra PTYs. Stop once the
  // returned descriptor is above stderr; RAII releases that descriptor too.
  for (size_t i = 0; i < 3; i++) {
    low[i].fd = open("/dev/null", O_RDWR | O_CLOEXEC);
    if (low[i].fd < 0) { *err = errno; return; }
    if (low[i].fd >= STDERR_FILENO) break;
  }
  master_fd.fd = posix_openpt(O_RDWR | O_NOCTTY);
  if (master_fd.fd < 0) { *err = errno; return; }
  if (grantpt(master_fd.fd) < 0 || unlockpt(master_fd.fd) < 0) {
    *err = errno; return;
  }
  char slave_name[128];
  if (ioctl(master_fd.fd, TIOCPTYGNAME, slave_name) < 0) { *err = errno; return; }
  slave_fd.fd = open(slave_name, O_RDWR | O_NOCTTY);
  if (slave_fd.fd < 0) { *err = errno; return; }
  if (termp && tcsetattr(slave_fd.fd, TCSANOW, termp) < 0) { *err = errno; return; }
  if (winp && ioctl(slave_fd.fd, TIOCSWINSZ, winp) < 0) { *err = errno; return; }

  posix_spawn_file_actions_t acts;
  *err = posix_spawn_file_actions_init(&acts);
  if (*err) return;
  posix_spawnattr_t attrs;
  *err = posix_spawnattr_init(&attrs);
  if (*err) { posix_spawn_file_actions_destroy(&acts); return; }
  // Every posix_spawn API returns its error number rather than setting errno.
  do {
    if ((*err = posix_spawn_file_actions_adddup2(&acts, slave_fd.fd, STDIN_FILENO))) break;
    if ((*err = posix_spawn_file_actions_adddup2(&acts, slave_fd.fd, STDOUT_FILENO))) break;
    if ((*err = posix_spawn_file_actions_adddup2(&acts, slave_fd.fd, STDERR_FILENO))) break;
    if ((*err = posix_spawn_file_actions_addclose(&acts, slave_fd.fd))) break;
    if ((*err = posix_spawn_file_actions_addclose(&acts, master_fd.fd))) break;
    int flags = POSIX_SPAWN_CLOEXEC_DEFAULT | POSIX_SPAWN_SETSIGDEF |
                POSIX_SPAWN_SETSIGMASK | POSIX_SPAWN_SETSID;
    if ((*err = posix_spawnattr_setflags(&attrs, flags))) break;
    sigset_t signals;
    sigfillset(&signals);
    if ((*err = posix_spawnattr_setsigdefault(&attrs, &signals))) break;
    sigemptyset(&signals);
    if ((*err = posix_spawnattr_setsigmask(&attrs, &signals))) break;
    do { *err = posix_spawn(pid, argv[0], &acts, &attrs, argv, env); }
    while (*err == EINTR);
  } while (false);
  posix_spawn_file_actions_destroy(&acts);
  posix_spawnattr_destroy(&attrs);
  if (!*err) { *master = master_fd.fd; master_fd.fd = -1; }
}
