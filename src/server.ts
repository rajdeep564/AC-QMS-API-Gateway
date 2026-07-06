import app from "./app";
import { config } from "./config/env";

app.listen(config.port, () => {
  console.log(`AC-QMS server listening at http://localhost:${config.port}`);
});
