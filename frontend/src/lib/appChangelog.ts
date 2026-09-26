import changelogMarkdown from "../../CHANGELOG.md?raw";
import { parseChangelog } from "./changelog";

/**
 * The version and changelog this bundle was built from. Both are compiled in,
 * so the dialog needs no fetch and always matches what is deployed.
 */
export const APP_VERSION: string = __APP_VERSION__;
export const RELEASES = parseChangelog(changelogMarkdown);
