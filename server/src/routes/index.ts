import { Router } from "express";
import authRoutes from "../modules/auth/auth.routes";
import { awsDocRouter, awsSectionRouter } from "../modules/aws/aws.routes";
import batchesRoutes from "../modules/batches/batches.routes";
import documentsRoutes from "../modules/documents/documents.routes";
import mastersRoutes from "../modules/masters/masters.routes";
import marketingRoutes from "../modules/marketing/marketing.routes";
import notificationsRoutes from "../modules/notifications/notifications.routes";
import productsRoutes from "../modules/products/products.routes";
import specTemplatesRoutes from "../modules/spec-templates/spec-templates.routes";

const router = Router();

router.use("/auth", authRoutes);
router.use("/products", productsRoutes);
router.use("/masters", mastersRoutes);
router.use("/spec-templates", specTemplatesRoutes);
router.use("/batches", batchesRoutes);
router.use("/documents", documentsRoutes);
router.use("/marketing", marketingRoutes);
router.use("/notifications", notificationsRoutes);
router.use("/aws", awsDocRouter);
router.use("/aws-sections", awsSectionRouter);

export default router;
