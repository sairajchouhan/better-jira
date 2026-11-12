import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";

/** Media feedback shares the app queue and dismissible toast chrome. */
export function notifyMedia(message: string) {
  return toasts.show(
    <Toast>
      {message}
      <Toast.Close />
    </Toast>,
  );
}
