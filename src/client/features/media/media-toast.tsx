import { Toast } from "@/client/components/toast";
import { toasts } from "@/client/components/toast-queue";

/** Media feedback shares the app queue and dismissible toast chrome; the same message again replaces its toast, as Linear's
 *  toast id is its content (BJ-271). */
export function notifyMedia(message: string) {
  return toasts.show(
    <Toast>
      {message}
      <Toast.Close />
    </Toast>,
    { id: `media:${message}` },
  );
}
