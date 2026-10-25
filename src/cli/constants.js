/** @module cli/constants Names, flags and exit codes of the `golfo-lint` command. */

/** Name of the binary, as printed in usage messages. */
export const CLI_NAME = "golfo-lint";

/** Prints the usage message. */
export const HELP_FLAGS = ["--help", "-h"];

/** Path analyzed when the subcommand gets no arguments. */
export const DEFAULT_ANALYZED_PATH = ".";

/** Project file that replaces the jscpd defaults of `golfo-lint duplicates`. */
export const JSCPD_PROJECT_CONFIG_FILE = ".jscpd.json";

/** Exit code of a run whose checks all passed. */
export const EXIT_CODE_SUCCESS = 0;

/** Exit code of a run whose subcommand was not recognized. */
export const EXIT_CODE_USAGE_ERROR = 2;

/** Exit code of a run that could not start the tool it needs. */
export const EXIT_CODE_TOOL_UNAVAILABLE = 3;

/** Exit code of a setup command that could not tell where to connect its tool, so it changed nothing. */
export const EXIT_CODE_SETUP_NOT_DETECTED = 4;
