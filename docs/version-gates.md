# Version gates

Every `at_least` boundary in the engine, what stands on each side of it, and how much of it is cited. Generated from the
source; a gate is a release a rule starts at, and "last before" and "first from" are the registered releases around it.

541 sites use these boundaries. 284 carry a source citation within 12 lines, 257 do not: an uncited site is not wrong, but
its evidence is only the replays. Recordings exist on both sides of every boundary, which says the replays can tell the two
sides apart only where a case reaches that branch: no per-gate mutation has been run. No gate is below 1.8.8, so none is dead
by range, and none has been removed.

| gate | sites | last before | first from | recordings both sides | same oracle both sides |
|---|---:|---|---|---|---|
| 1.9.0 | 49 | 1.8.8 | 1.9.4 | yes | none |
| 1.10.0 | 5 | 1.9.4 | 1.10.2 | yes | none |
| 1.11.0 | 18 | 1.10.2 | 1.11.2 | yes | none |
| 1.12.0 | 6 | 1.11.2 | 1.12.2 | yes | none |
| 1.13.0 | 36 | 1.12.2 | 1.13.2 | yes | none |
| 1.14.0 | 76 | 1.13.2 | 1.14.4 | yes | none |
| 1.15.0 | 14 | 1.14.4 | 1.15 | yes | none |
| 1.15.2 | 1 | 1.15.1 | 1.15.2 | yes | none |
| 1.16.0 | 41 | 1.15.2 | 1.16 | yes | none |
| 1.16.2 | 15 | 1.16.1 | 1.16.2 | yes | none |
| 1.16.4 | 1 | 1.16.3 | 1.16.4 | yes | none |
| 1.17.0 | 47 | 1.16.5 | 1.17 | yes | none |
| 1.18.0 | 10 | 1.17.1 | 1.18 | yes | none |
| 1.18.2 | 7 | 1.18.1 | 1.18.2 | yes | none |
| 1.19.0 | 5 | 1.18.2 | 1.19 | yes | none |
| 1.19.3 | 2 | 1.19.2 | 1.19.3 | yes | none |
| 1.19.4 | 8 | 1.19.3 | 1.19.4 | yes | none |
| 1.20.0 | 11 | 1.19.4 | 1.20 | yes | none |
| 1.20.2 | 3 | 1.20.1 | 1.20.2 | yes | none |
| 1.20.3 | 4 | 1.20.2 | 1.20.3 | yes | none |
| 1.20.5 | 26 | 1.20.4 | 1.20.5 | yes | living |
| 1.21.0 | 14 | 1.20.6 | 1.21 | yes | none |
| 1.21.2 | 45 | 1.21.1 | 1.21.2 | yes | none |
| 1.21.4 | 8 | 1.21.3 | 1.21.4 | yes | epsilon,move |
| 1.21.5 | 31 | 1.21.4 | 1.21.5 | yes | epsilon,move |
| 1.21.6 | 9 | 1.21.5 | 1.21.6 | yes | none |
| 1.21.9 | 9 | 1.21.8 | 1.21.9 | yes | epsilon,move |
| 1.21.10 | 2 | 1.21.9 | 1.21.10 | yes | epsilon |
| 1.21.11 | 4 | 1.21.10 | 1.21.11 | yes | epsilon,living |
| 26.1.0 | 11 | 1.21.11 | 26.1 | yes | none |
| 26.2.0 | 9 | 26.1.2 | 26.2 | yes | none |
| 26.3.0 | 14 | 26.2 | 26.3 | yes | living,move,shapes |
