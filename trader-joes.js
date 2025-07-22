const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
    const linksPath = path.join(__dirname, "tjlinks.json");
    let links = [];

    try {
        const linksData = fs.readFileSync(linksPath, "utf8");
        links = JSON.parse(linksData);
        console.log(`Found ${links.length} links to scrape`);
    } catch (error) {
        console.error("Error reading links.json:", error.message);
        process.exit(1);
    }

    const browser = await chromium.launch({
        headless: false,
        slowMo: 50,
        args: [
            "--disable-blink-features=AutomationControlled",
            "--disable-features=IsolateOrigins,site-per-process",
        ],
    });

    const context = await browser.newContext({
        userAgent:
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36",
        viewport: { width: 1920, height: 1080 },
        locale: "en-US",
        timezoneId: "America/New_York",
    });

    const page = await context.newPage();
    let allProducts = [];

    try {
        for (let linkIndex = 0; linkIndex < links.length; linkIndex++) {
            const linkData = links[linkIndex];
            const { url, cat, source } = linkData;

            console.log(
                `\n=== Processing link ${linkIndex + 1}/${links.length} ===`
            );
            console.log(`Category: ${cat}`);
            console.log(`URL: ${url}`);

            let currentPage = 1;
            let categoryProducts = [];

            console.log("Navigating to Trader Joes homepage...");
            await page.goto("https://www.traderjoes.com", {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });

            await page.waitForTimeout(2000);

            console.log(`Navigating to ${cat} section...`);
            await page.goto(url, {
                waitUntil: "domcontentloaded",
                timeout: 60000,
            });

            while (true) {
                await page.waitForTimeout(3000);

                console.log(
                    `Scraping page ${currentPage} of ${cat} category...`
                );
                console.log("Waiting for product tiles...");

                try {
                    await page.waitForSelector(
                        '[class="SearchResultCard_searchResultCard__3V-_h"]',
                        {
                            timeout: 30000,
                        }
                    );
                } catch (error) {
                    console.log(
                        "No product tiles found, skipping this category..."
                    );
                    break;
                }

                console.log("Extracting product information...");

                const products = await page.$$eval(
                    '[class="SearchResultCard_searchResultCard__3V-_h"]',
                    (tiles) =>
                        tiles.map((tile) => {
                            const title =
                                tile.querySelector("h3")?.textContent?.trim() ||
                                tile
                                    .querySelector(
                                        'h3[class^="SearchResultCard_searchResultCard__title"]'
                                    )
                                    ?.textContent?.trim() ||
                                tile
                                    .querySelector("a span")
                                    ?.textContent?.trim() ||
                                "N/A";

                            const priceElement =
                                tile.querySelector(
                                    'span[class^="ProductPrice_productPrice__price"] '
                                ) ||
                                tile.querySelector(
                                    'div[class^="ProductPrice_productPrice__price"]'
                                ) ||
                                tile.querySelector('span[class*="price"]');

                            const price =
                                priceElement?.textContent?.trim() || "N/A";

                            const linkElement =
                                tile.querySelector(
                                    'a[class^="SearchResultCard_searchResultCard__titleLink"]'
                                ) || tile.querySelector("a");
                            const link = linkElement?.href || "N/A";

                            const imageLink =
                                tile.querySelector("picture img") ||
                                tile.querySelector("picture source") ||
                                tile.querySelector("img");
                            const image =
                                imageLink?.getAttribute("src") || "N/A";

                            return {
                                title,
                                price,
                                image,
                                link: link.startsWith("/")
                                    ? `https://www.traderjoes.com${link}`
                                    : link,
                            };
                        })
                );

                const productsWithCategory = products.map((product) => ({
                    ...product,
                    category: cat,
                }));

                console.log(
                    `Found ${products.length} products on page ${currentPage}`
                );
                categoryProducts =
                    categoryProducts.concat(productsWithCategory);

                const nextPageButton =
                    (await page.$(
                        "button.Pagination_pagination__arrow__3TJf0.Pagination_pagination__arrow_side_right__9YUGr"
                    )) ||
                    (await page.$('button[class*="arrow_side_right"]')) ||
                    (await page.$('button[aria-label^="Next page"]'));

                if (nextPageButton) {
                    const isDisabled = await nextPageButton.evaluate(
                        (el) =>
                            el.hasAttribute("disabled") ||
                            el.getAttribute("aria-disabled") === "true"
                    );

                    if (!isDisabled) {
                        console.log("Navigating to next page...");
                        await nextPageButton.click();
                        currentPage++;

                        await page.waitForTimeout(3000);

                        try {
                            await page.waitForSelector(
                                '[data-dca-name="ui_product_tile:vertical_index"]',
                                {
                                    timeout: 10000,
                                    state: "attached",
                                }
                            );
                        } catch (e) {
                            console.log("Continuing after timeout...");
                        }
                    } else {
                        console.log(
                            "Next page button is disabled. Reached last page."
                        );
                        break;
                    }
                } else {
                    console.log(
                        "No next page button found. This might be the last page."
                    );
                    break;
                }
            }

            console.log(
                `Total products found for ${cat}: ${categoryProducts.length}`
            );
            allProducts = allProducts.concat(categoryProducts);
        }

        console.log(
            `\nTotal products found across all categories: ${allProducts.length}`
        );

        const csvHeader = "Title,Price,Rating,Category,Link\n";
        const csvContent = allProducts
            .map((product) => {
                const escapedTitle = `"Trader Joe's ${product.title.replace(
                    /"/g,
                    '""'
                )}"`;
                const escapedLink = `"${product.link.replace(/"/g, '""')}"`;
                const escapedCategory = `"${product.category.replace(
                    /"/g,
                    '""'
                )}"`;
                return `${escapedTitle},${product.price},${product.rating},${escapedCategory},${escapedLink}`;
            })
            .join("\n");

        const fullCsvContent = csvHeader + csvContent;

        const filename = `Trader Joes-exported.csv`;
        const filepath = path.join(__dirname, filename);

        fs.writeFileSync(filepath, fullCsvContent, "utf8");
        console.log(`\nData saved to: ${filename}`);
        console.log(`Total products scraped: ${allProducts.length}`);

        console.log("\nProducts by category:");
        const categorySummary = {};
        allProducts.forEach((product) => {
            categorySummary[product.category] =
                (categorySummary[product.category] || 0) + 1;
        });
        console.table(categorySummary);
    } catch (error) {
        console.error("Error occurred:", error.message);
        console.error("Full error:", error);
    } finally {
        await browser.close();
    }
})();
