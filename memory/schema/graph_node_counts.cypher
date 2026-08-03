// F5 support: per-label node counts for one graph. Used to demonstrate that two task graphs
// queried at the same time never see each other's nodes (per-task isolation).
MATCH (n)
RETURN labels(n)[0] AS label, count(n) AS count
