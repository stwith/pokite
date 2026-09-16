// One in-flight read and one coalesced follow-up; no timers while hidden/settled.
export function createRefreshLoop({
  refresh,
  interval,
  isVisible,
  isConnected,
  isDone = () => false,
  schedule = setTimeout,
  cancel = clearTimeout,
  onError = () => {},
}) {
  let timer,
    running = false,
    pending = false,
    disposed = false;
  const clear = () => {
    cancel(timer);
    timer = undefined;
  };
  const active = () => !disposed && isVisible() && !isDone();
  const reschedule = () => {
    clear();
    if (active() && !running)
      timer = schedule(trigger, isConnected() ? 30000 : interval);
  };
  async function trigger() {
    clear();
    if (!active()) {
      pending = false;
      return;
    }
    if (running) {
      pending = true;
      return;
    }
    running = true;
    try {
      await refresh();
    } catch (error) {
      onError(error);
    } finally {
      running = false;
      if (pending && active()) {
        pending = false;
        void trigger();
      } else {
        pending = false;
        reschedule();
      }
    }
  }
  void trigger();
  return {
    trigger,
    reschedule,
    stop() {
      disposed = true;
      pending = false;
      clear();
    },
  };
}
