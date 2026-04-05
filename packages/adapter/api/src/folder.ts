import type { EntryStore } from "@headrss/core";
import { editLabel, listLabels } from "@headrss/core";
import type { OpenAPIHono } from "@hono/zod-openapi";
import { createRoute, z } from "@hono/zod-openapi";
import type { MiddlewareHandler } from "hono";
import type { NativeApiEnv } from "./shared.js";
import {
  errorResponseSchema,
  idPathParam,
  labelSchema,
  listLabelsResponseSchema,
  okResponseSchema,
} from "./shared.js";

const folderPathParamsSchema = z.object({
  id: idPathParam("id"),
});

const createFolderBodySchema = z.object({
  name: z.string().min(1),
});

const renameFolderBodySchema = z.object({
  name: z.string().min(1),
});

const listFoldersRoute = createRoute({
  method: "get",
  path: "/folders",
  responses: {
    200: {
      content: {
        "application/json": {
          schema: listLabelsResponseSchema,
        },
      },
      description: "Folders for the authenticated user.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
  },
});

const createFolderRoute = createRoute({
  method: "post",
  path: "/folders",
  request: {
    body: {
      content: {
        "application/json": {
          schema: createFolderBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: labelSchema,
        },
      },
      description: "Created or reused folder.",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
  },
});

const updateFolderRoute = createRoute({
  method: "put",
  path: "/folders/{id}",
  request: {
    params: folderPathParamsSchema,
    body: {
      content: {
        "application/json": {
          schema: renameFolderBodySchema,
        },
      },
      required: true,
    },
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: labelSchema,
        },
      },
      description: "Renamed folder.",
    },
    400: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Invalid request.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Folder not found.",
    },
    409: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Folder name already exists.",
    },
  },
});

const deleteFolderRoute = createRoute({
  method: "delete",
  path: "/folders/{id}",
  request: {
    params: folderPathParamsSchema,
  },
  responses: {
    200: {
      content: {
        "application/json": {
          schema: okResponseSchema,
        },
      },
      description: "Folder deleted.",
    },
    401: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Authentication required.",
    },
    404: {
      content: {
        "application/json": {
          schema: errorResponseSchema,
        },
      },
      description: "Folder not found.",
    },
  },
});

interface FolderRouteDeps {
  authMiddleware: MiddlewareHandler<NativeApiEnv>;
  store: EntryStore;
}

export function registerFolderRoutes(
  app: OpenAPIHono<NativeApiEnv>,
  deps: FolderRouteDeps,
): void {
  const openapi = app.openapi.bind(app) as any;

  openapi(
    {
      ...listFoldersRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const labels = await listLabels(deps.store, c.get("userId"));
      return c.json({ items: labels }, 200);
    },
  );

  openapi(
    {
      ...createFolderRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const label = await editLabel(deps.store, {
        action: "create",
        name: (
          c.req.valid("json" as never) as z.output<
            typeof createFolderBodySchema
          >
        ).name,
        userId: c.get("userId"),
      });

      if (label === null) {
        throw new Error("Folder creation did not return a label.");
      }

      return c.json(label, 200);
    },
  );

  openapi(
    {
      ...updateFolderRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const { id } = c.req.valid("param" as never) as z.output<
        typeof folderPathParamsSchema
      >;
      const label = await editLabel(deps.store, {
        action: "rename",
        labelId: id,
        name: (
          c.req.valid("json" as never) as z.output<
            typeof renameFolderBodySchema
          >
        ).name,
        userId: c.get("userId"),
      });

      if (label === null) {
        throw new Error("Folder rename did not return a label.");
      }

      return c.json(label, 200);
    },
  );

  openapi(
    {
      ...deleteFolderRoute,
      middleware: deps.authMiddleware,
    } as any,
    async (c: any) => {
      const params = c.req.valid("param" as never) as z.output<
        typeof folderPathParamsSchema
      >;
      await editLabel(deps.store, {
        action: "delete",
        labelId: params.id,
        target: "folder",
        userId: c.get("userId"),
      });

      return c.json({ ok: true as const }, 200);
    },
  );
}
