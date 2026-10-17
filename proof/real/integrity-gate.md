# No-seal variant (step 6): integrity gate record from the log file (path replaced)

## dev base: agent seal existed in migrated pristine: false

```
{"message":"agent database integrity gate","level":"INFO","agentId":"dev","path":"<path>","pid":17717,"threadId":6,"isMainThread":false,"admissionMode":"sync","integrityGateReason":"no-proof","integrityGateMode":"full","integrityGateOutcome":"healthy","integrityGateMs":3004,"integrityCheckSyncMs":3003,"integrityOutsideCheckMs":1,"canonicalIndexMs":17,"repairedIndexCount":0}
```

## dev patched: agent seal existed in migrated pristine: false

```
{"message":"agent database integrity gate","level":"INFO","agentId":"dev","path":"<path>","pid":18475,"threadId":6,"isMainThread":false,"admissionMode":"sync","integrityGateReason":"no-proof","integrityGateMode":"full","integrityGateOutcome":"healthy","integrityGateMs":2969,"integrityCheckSyncMs":2968,"integrityOutsideCheckMs":1,"canonicalIndexMs":15,"repairedIndexCount":0}
```

## main base: agent seal existed in migrated pristine: false

```
{"message":"agent database integrity gate","level":"INFO","agentId":"main","path":"<path>","pid":19291,"threadId":6,"isMainThread":false,"admissionMode":"sync","integrityGateReason":"no-proof","integrityGateMode":"full","integrityGateOutcome":"healthy","integrityGateMs":23767,"integrityCheckSyncMs":23767,"integrityOutsideCheckMs":0,"canonicalIndexMs":18,"repairedIndexCount":0}
```

## main patched: agent seal existed in migrated pristine: false

```
{"message":"agent database integrity gate","level":"INFO","agentId":"main","path":"<path>","pid":20297,"threadId":6,"isMainThread":false,"admissionMode":"sync","integrityGateReason":"no-proof","integrityGateMode":"full","integrityGateOutcome":"healthy","integrityGateMs":20314,"integrityCheckSyncMs":20313,"integrityOutsideCheckMs":1,"canonicalIndexMs":14,"repairedIndexCount":0}
```

