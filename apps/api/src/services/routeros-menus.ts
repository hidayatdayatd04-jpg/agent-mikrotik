/**
 * Comprehensive RouterOS Menu Catalog
 * Extracted from the RouterOS help corpus (ros-help.db).
 * Contains 595 verified RouterOS CLI menu paths.
 */
import { ROUTEROS_MENUS_A } from "./routeros-menus/menus-a";
import { ROUTEROS_MENUS_B } from "./routeros-menus/menus-b";
import { ROUTEROS_MENUS_C } from "./routeros-menus/menus-c";
import { ROUTEROS_MENUS_D } from "./routeros-menus/menus-d";
import { ROUTEROS_MENUS_E } from "./routeros-menus/menus-e";

export { ROUTEROS_ROOTS, ROUTEROS_ROOT_COMMANDS } from "./routeros-menus/roots";

export const ROUTEROS_MENUS = new Set<string>([
  ...ROUTEROS_MENUS_A,
  ...ROUTEROS_MENUS_B,
  ...ROUTEROS_MENUS_C,
  ...ROUTEROS_MENUS_D,
  ...ROUTEROS_MENUS_E,
]);
