#include <Security/Security.h>
#include <stdio.h>
#include <string.h>
#include <sys/resource.h>
#include <sys/stat.h>
#include <unistd.h>

int main(int argc, char **argv) {
  const int check = argc == 2 && strcmp(argv[1], "--check") == 0;
  if (argc == 2 && strcmp(argv[1], "--version") == 0) {
    puts("pokite-claude-keychain 1");
    return 0;
  }
  if (argc != 1 && !check) return 64;
  struct rlimit limit = {0, 0};
  setrlimit(RLIMIT_CORE, &limit);
  struct stat output;
  // Never print a secret to a terminal or redirect it into a regular file.
  if (!check && (fstat(STDOUT_FILENO, &output) != 0 ||
      !(S_ISFIFO(output.st_mode) || S_ISSOCK(output.st_mode)))) return 64;
  if (check) SecKeychainSetUserInteractionAllowed(false);
  const char *service = "Claude Safe Storage";
  const char *account = "Claude";
  UInt32 length = 0;
  void *secret = NULL;
  OSStatus status = SecKeychainFindGenericPassword(NULL,
      (UInt32)strlen(service), service, (UInt32)strlen(account), account,
      &length, &secret, NULL);
  if (status != errSecSuccess) {
    fprintf(stderr, "keychain status: %d\n", (int)status);
    return status == errSecInteractionNotAllowed || status == errSecAuthFailed ||
        status == errSecUserCanceled ? 77 : 78;
  }
  int failed = 0;
  if (!check) {
    UInt32 sent = 0;
    while (sent < length) {
      ssize_t n = write(STDOUT_FILENO, (char *)secret + sent, length - sent);
      if (n <= 0) { failed = 1; break; }
      sent += (UInt32)n;
    }
  }
  volatile unsigned char *bytes = secret;
  for (UInt32 i = 0; i < length; i++) bytes[i] = 0;
  SecKeychainItemFreeContent(NULL, secret);
  return failed ? 74 : 0;
}
