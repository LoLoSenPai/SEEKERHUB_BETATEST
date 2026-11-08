import { randomBytes, randomUUID } from "node:crypto";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { expect, test as base, type Locator, type Page } from "@playwright/test";
import { hashPassword } from "better-auth/crypto";

// Run only when the coordinator provides an explicitly enabled disposable local DB.
function localEnvironment() {
  const databaseUrl = process.env.DATABASE_URL;
  const baseUrl = process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000";
  if (process.env.RUN_INTEGRATION_TESTS !== "true" || !databaseUrl) throw new Error("Explicit local integration environment required.");
  const db = new URL(databaseUrl);
  const app = new URL(baseUrl);
  if (!["postgres:", "postgresql:"].includes(db.protocol) || !["localhost", "127.0.0.1"].includes(db.hostname) ||
      !db.pathname.toLowerCase().includes("test") || !["localhost", "127.0.0.1"].includes(app.hostname) || app.protocol !== "http:") {
    throw new Error("Submission tests require a disposable local test DB and app.");
  }
  return { databaseUrl, baseUrl: app.origin };
}

const test = base.extend<{ builder: { slug: string; releaseId: string; id: string; prisma: PrismaClient } }>({
  builder: async ({ page }, provide) => {
    const { databaseUrl, baseUrl } = localEnvironment();
    const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: databaseUrl }) });
    const id = randomUUID();
    const email = `transitions-${id}@example.test`;
    const password = `Transitions-${id}`;
    try {
      // Each fixture has its own real auth rate-limit bucket; never clear shared buckets.
      const octets = randomBytes(2);
      await page.context().setExtraHTTPHeaders({ "x-forwarded-for": `198.18.${octets[0]}.${octets[1]}` });
      const user = await prisma.user.create({ data: { name: "Transition builder", email, emailVerified: true, builderProfile: { create: { maxProjects: 10 } } } });
      await prisma.account.create({ data: { userId: user.id, accountId: user.id, providerId: "credential", password: await hashPassword(password) } });
      const project = await prisma.appProject.create({ data: { ownerId: user.id, name: "Transition project", slug: `transitions-${id}` } });
      const release = await prisma.release.create({ data: { projectId: project.id, createdById: user.id, status: "DRAFT", versionName: "1.0", versionCode: 1, changelog: "Draft release" } });
      await page.goto(`${baseUrl}/sign-in?method=password&returnTo=${encodeURIComponent(`/builder/apps/${project.slug}`)}`);
      await page.getByLabel("Email", { exact: true }).fill(email);
      await page.getByLabel("Password", { exact: true }).fill(password);
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(page).toHaveURL(`${baseUrl}/builder/apps/${project.slug}`);
      await provide({ slug: project.slug, releaseId: release.id, id, prisma });
    } finally {
      await prisma.$disconnect();
    }
  },
});

async function duplicateSubmit(form: Locator) {
  await form.evaluate((element) => {
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    element.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
  });
  // Let unexpected duplicate requests reach the route counters before asserting.
  await form.page().waitForTimeout(200);
}

async function holdNavigation(page: Page, pathname: string) {
  let release!: () => void;
  let arrived!: () => void;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  const requested = new Promise<void>((resolve) => { arrived = resolve; });
  await page.route((url) => url.pathname === pathname, async (route) => {
    if (route.request().method() !== "GET") return route.continue();
    arrived();
    await gate;
    await route.continue();
  });
  return { requested, release };
}

test("project create preserves values and lock through navigation; failure permits retry; save stays editable", async ({ page, builder }) => {
  await page.getByRole("link", { name: "New app", exact: true }).click();
  // The previous project page also has App name/Description: wait for the create form.
  await expect(page.getByRole("heading", { name: "Create app project", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeVisible();
  const name = `created-${builder.id}`;
  await page.getByLabel("App name").fill(name);
  await page.getByLabel("Description", { exact: true }).fill("Keep submitted description");
  let requests = 0;
  await page.route("**/builder/apps/new", async (route) => {
    if (!route.request().headers()["next-action"]) return route.continue();
    requests++;
    if (requests === 1) return route.abort("failed");
    await route.continue();
  });
  const form = page.getByLabel("App name").locator("xpath=ancestor::form");
  await duplicateSubmit(form);
  await expect(page.getByRole("alert").filter({ hasText: "Unable to save" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Create project", exact: true })).toBeEnabled();
  await expect(page.getByLabel("App name")).toHaveValue(name);
  const destination = `/builder/apps/${name}`;
  const navigation = await holdNavigation(page, destination);
  try {
    await duplicateSubmit(form);
    await expect.poll(() => requests, { message: "Project retry must issue exactly one additional action" }).toBe(2);
    await expect(page.getByRole("alert").filter({ hasText: "Unable to save" })).toHaveCount(0);
    await navigation.requested;
    // Keep the old page mounted beyond the reported one-second re-enable window.
    await page.waitForTimeout(1200);
    await expect(page.getByRole("button", { name: "Creating project..." })).toBeDisabled();
    await expect(page.getByLabel("App name")).toHaveValue(name);
    await expect(page.getByLabel("Description", { exact: true })).toHaveValue("Keep submitted description");
    await duplicateSubmit(form);
    expect(requests).toBe(2);
    expect(await builder.prisma.appProject.count({ where: { name } })).toBe(1);
  } finally { navigation.release(); }
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
  await page.getByLabel("App name").fill("Edited name");
  await page.getByRole("button", { name: "Save project", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "Project saved." })).toBeVisible();
  await expect(page.getByLabel("App name")).toHaveValue("Edited name");
  await expect(page.getByLabel("App name")).toBeEditable();
  await page.getByLabel("App name").fill("Another edit");
  await expect(page.getByText("Project saved.", { exact: true })).toHaveCount(0);
});

test("APK finalize error retries the saved upload; success stays locked until destination", async ({ page, builder }) => {
  await page.getByRole("link", { name: "Upload release", exact: true }).click();
  let reservations = 0;
  let finalizations = 0;
  await page.route("**/api/uploads/releases", async (route) => {
    reservations++;
    await route.fulfill({ json: { sessionId: "transition-session", uploadUrl: `${new URL(page.url()).origin}/api/transition-upload-put` } });
  });
  await page.route("**/api/transition-upload-put", (route) => route.fulfill({ status: 200, body: "" }));
  await page.route("**/api/uploads/releases/transition-session/finalize", async (route) => {
    finalizations++;
    await route.fulfill(finalizations === 1 ? { status: 503, json: { error: "Retry saved APK" } } : { json: { releaseId: builder.releaseId } });
  });
  await page.getByLabel("Choose a signed Android APK").setInputFiles({ name: "transition.apk", mimeType: "application/vnd.android.package-archive", buffer: Buffer.from("mocked APK") });
  await expect(page.getByRole("button", { name: "Upload and check APK", exact: true })).toBeEnabled();
  await expect(page.getByText("transition.apk", { exact: false })).toBeVisible();
  const form = page.getByLabel("Choose a signed Android APK").locator("xpath=ancestor::form");
  await duplicateSubmit(form);
  await expect(page.getByRole("alert").filter({ hasText: "Retry saved APK" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Retry APK validation" })).toBeEnabled();
  const navigation = await holdNavigation(page, `/builder/apps/${builder.slug}/releases/${builder.releaseId}`);
  try {
    await duplicateSubmit(form);
    await expect.poll(() => finalizations, { message: "APK retry must finalize the saved session once" }).toBe(2);
    await expect(page.getByRole("alert").filter({ hasText: "Retry saved APK" })).toHaveCount(0);
    await navigation.requested;
    await page.waitForTimeout(1200);
    await expect(page.getByRole("button", { name: "Saving your APK..." })).toBeDisabled();
    await expect(page.getByLabel("Choose a signed Android APK")).toBeDisabled();
    await expect(page.getByText("transition.apk", { exact: false })).toBeVisible();
    await duplicateSubmit(form);
    expect(reservations).toBe(1);
    expect(finalizations).toBe(2);
  } finally { navigation.release(); }
  await expect(page.getByText("Prepare your release", { exact: true })).toBeVisible();
});

test("publish failure retains review and permits retry; success holds controls through navigation", async ({ page, builder }) => {
  await page.locator(`a[href="/builder/apps/${builder.slug}/releases/${builder.releaseId}"]`).click();
  await page.getByLabel(/What should testers try/).fill("Retain these submitted notes");
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  let publications = 0;
  const destination = `/builder/apps/${builder.slug}`;
  await page.route(`**/api/releases/${builder.releaseId}/publish`, async (route) => {
    publications++;
    expect(route.request().postDataJSON().changelog).toBe("Retain these submitted notes");
    await route.fulfill(publications === 1 ? { status: 503, json: { error: "Please retry publication" } } : { json: { redirectTo: destination } });
  });
  const form = page.locator("form").filter({ has: page.locator('textarea[name="changelog"]') });
  await duplicateSubmit(form);
  await expect(page.getByRole("alert").filter({ hasText: "Please retry publication" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Publish and create link", exact: true })).toBeEnabled();
  await expect(page.getByText("Retain these submitted notes", { exact: true })).toBeVisible();
  const navigation = await holdNavigation(page, destination);
  try {
    await duplicateSubmit(form);
    await expect.poll(() => publications, { message: "Publication retry must issue one additional request" }).toBe(2);
    await expect(page.getByRole("alert").filter({ hasText: "Please retry publication" })).toHaveCount(0);
    await navigation.requested;
    await page.waitForTimeout(1200);
    await expect(page.getByRole("button", { name: "Publishing...", exact: true })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Back", exact: true })).toBeDisabled();
    await duplicateSubmit(form);
    expect(publications).toBe(2);
  } finally { navigation.release(); }
  await expect(page).toHaveURL(new RegExp(`${destination}$`));
});

test("builder email sign-in preserves values and synchronous lock after success; error permits retry", async ({ page }) => {
  const { baseUrl } = localEnvironment();
  await page.goto(`${baseUrl}/sign-in?method=password&returnTo=%2Fbuilder%2Fapps%2Fnew`);
  let attempts = 0;
  await page.route("**/api/auth/sign-in/email", async (route) => {
    attempts++;
    await route.fulfill(attempts === 1 ? { status: 401, json: { message: "Invalid credentials" } } : { json: { user: { id: "mock-builder", email: "transitions@example.test" }, token: "mock-token", redirect: false } });
  });
  await page.getByLabel("Email", { exact: true }).fill("transitions@example.test");
  await page.getByLabel("Password", { exact: true }).fill("transition-password");
  const form = page.getByLabel("Email", { exact: true }).locator("xpath=ancestor::form");
  await duplicateSubmit(form);
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeEnabled();
  const navigation = await holdNavigation(page, "/builder/apps/new");
  try {
    await duplicateSubmit(form);
    await navigation.requested;
    await page.waitForTimeout(1200);
    await expect(page.getByRole("button", { name: "Signing in...", exact: true })).toBeDisabled();
    await expect(page.getByLabel("Email", { exact: true })).toHaveValue("transitions@example.test");
    await expect(page.getByLabel("Password", { exact: true })).toHaveValue("transition-password");
    await duplicateSubmit(form);
    expect(attempts).toBe(2);
  } finally { navigation.release(); }
});
