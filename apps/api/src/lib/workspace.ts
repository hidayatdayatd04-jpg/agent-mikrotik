/** One server-owned data scope, linked to the seeded local account and accessed via session cookies. */
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export interface WorkspaceContext { userId: string }
export const localWorkspace: WorkspaceContext = { userId: LOCAL_WORKSPACE_ID };
