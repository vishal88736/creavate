# Creavate

**Create more. Coordinate less.**

Connect platforms. Collaborate with AI. Focus on creating.

Creavate coordinates a creator's sponsorship workflow: Gmail inquiry → AI deal analysis → creator approval in Slack → campaign organization in Drive, Calendar and tasks. Switch carries agent handoffs; application tools enforce recorded approvals.

Current status: **Phase 0 discovery checkpoint. The live Switch/Slack gate is not passed.** No production agents, Google integration or dashboard have been implemented.

- [Switch integration findings and open questions](SWITCH_INTEGRATION.md)
- [Phase 0 setup and real-service probe](docs/phase0/RUNBOOK.md)
- [Observed evidence and limitations](docs/phase0/OBSERVATIONS.md)
- [Task list](TASKS.md) · [Decisions](DECISIONS.md)
- [Dashboard reference for Phase 6](docs/design/README.md)

The probe is deliberately isolated under spikes/switch-mention. Its unit tests use synthetic inputs only inside the test file. Product views will use actual data; Instagram and YouTube remain out of scope.
