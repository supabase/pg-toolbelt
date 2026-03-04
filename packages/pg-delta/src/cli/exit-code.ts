let _exitCode: number | undefined;
export function setCommandExitCode(code: number) {
  _exitCode = code;
}
export function getCommandExitCode() {
  return _exitCode;
}
