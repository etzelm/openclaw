import { workspaceProfileLooksConfigured, workspaceRequiredBootstrapLooksCustomized } from "../../pr-165112/src/agents/workspace.ts";
const dir = process.argv[2];
console.log("profileLooksConfigured", await workspaceProfileLooksConfigured({ dir }));
console.log("requiredBootstrapCustomized", await workspaceRequiredBootstrapLooksCustomized(dir));
