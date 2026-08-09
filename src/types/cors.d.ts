declare module "cors" {
  import type { RequestHandler } from "express";

  type CorsOptions = {
    origin?: string | boolean | RegExp | Array<string | RegExp>;
    credentials?: boolean;
    methods?: string | string[];
  };

  function cors(options?: CorsOptions): RequestHandler;
  export default cors;
}
