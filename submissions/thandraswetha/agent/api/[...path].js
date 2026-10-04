import { createApplication } from "../src/application.js";

let applicationPromise;

async function handler(request, response) {
  applicationPromise ??= createApplication();
  const { app } = await applicationPromise;
  return app(request, response);
}

export const config = {
  api: {
    bodyParser: false,
  },
};

export default handler;
