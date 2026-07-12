import { createApp } from "./app";

export default {
  fetch(request: Request): Promise<Response> {
    return createApp().fetch(request);
  },
};
