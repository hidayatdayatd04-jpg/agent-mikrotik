/** One server-owned workspace; there are no accounts or login sessions. */
export const LOCAL_WORKSPACE_ID = "00000000-0000-4000-8000-000000000001";
export interface WorkspaceContext { userId: string }
export const localWorkspace: WorkspaceContext = { userId: LOCAL_WORKSPACE_ID };
