// Pin the shared compute capacity to one permit, as on a one- or two-core host:
// getWorkerComputeCapacity() grants max(1, availableParallelism() - 1).
const os = require("node:os");
os.availableParallelism = () => 2;
require("node:module").syncBuiltinESMExports();
