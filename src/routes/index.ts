import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import batchesRoutes from "../modules/batches/batches.routes";
import documentsRoutes from "../modules/documents/documents.routes";
import mastersRoutes from "../modules/masters/masters.routes";
import notificationsRoutes from "../modules/notifications/notifications.routes";
import productsRoutes from "../modules/products/products.routes";
import specsRoutes from "../modules/specs/specs.routes";
import { awsDocRouter, awsSectionRouter } from "../modules/aws/aws.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/products", productsRoutes);
router.use("/masters", mastersRoutes);
router.use("/specs", specsRoutes);
router.use("/batches", batchesRoutes);
router.use("/documents", documentsRoutes);
router.use("/aws/documents", awsDocRouter);
router.use("/aws/sections", awsSectionRouter);
router.use("/notifications", notificationsRoutes);

export default router;
