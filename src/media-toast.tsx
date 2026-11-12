import { Toast } from "./toast";
import { toasts } from "./toast-queue";

/** Media feedback shares the app queue and dismissible toast chrome. */
export function notifyMedia(message: string) {
  return toasts.show(
    <Toast>
      {message}
      <Toast.Close />
    </Toast>,
  );
}
