export function logFailure(label, res, expectedStatuses = [200]) {
  if (!expectedStatuses.includes(res.status)) {
    const body = res.body ? res.body.slice(0, 150) : '(no body — timeout or connection error)';
    console.log(`FAIL ${label} | status=${res.status} | duration=${res.timings.duration.toFixed(2)}ms | body=${body}`);
  }
}
