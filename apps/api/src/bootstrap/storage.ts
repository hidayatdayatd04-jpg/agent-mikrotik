import { config } from "./foundation";
import { createStorageService } from "../services/storage";

export const storage = createStorageService({ directory: config.DATA_DIR });
