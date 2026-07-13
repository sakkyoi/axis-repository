import { createApp } from "./app";

const app = createApp();

export default {
  fetch(request: Request): Promise<Response> {
    return app.fetch(request);
  },
};
