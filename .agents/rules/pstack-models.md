# pstack model configuration. One line per role. Delete a line to fall back to the skill default.
# `inherit-parent` or `auto` as a value: the role runs on the parent chat model (omit Agent `model` and spawn `general-purpose`). Alias entries in a panel list still count toward its fan-out.
# defaults: 3
# budget: medium (high)
feature, refactoring: inherit-parent
bug-fix: inherit-parent
perf-issue: inherit-parent
hillclimb: inherit-parent
judgment and prose: inherit-parent
arena runners: fable medium, opus medium, inherit-parent
arena cross-judge pool: opus medium, inherit-parent
swarm workers: inherit-parent
interrogate reviewers: fable medium, opus medium, inherit-parent
