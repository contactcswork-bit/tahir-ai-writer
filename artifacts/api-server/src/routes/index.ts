import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import usersRouter from "./users";
import sitesRouter from "./sites";
import foldersRouter from "./folders";
import articlesRouter from "./articles";
import generateRouter from "./generate";
import dashboardRouter from "./dashboard";
import settingsRouter from "./settings";
import fetchLinksRouter from "./fetch-links";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(usersRouter);
router.use(sitesRouter);
router.use(foldersRouter);
router.use(articlesRouter);
router.use(generateRouter);
router.use(dashboardRouter);
router.use(settingsRouter);
router.use(fetchLinksRouter);

export default router;
