const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

(async () => {
    const linksPath = path.join(__dirname, "links.json");
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

            console.log("Navigating to Walmart homepage...");
            await page.goto("https://www.walmart.com", {
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
                        '[data-dca-name="ui_product_tile:vertical_index"]',
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

                const products = await page.$eval(
                    '[data-dca-name="ui_product_tile:vertical_index"]',
                    (tiles) =>
                        tiles.map((tile) => {
                            const title =
                                tile
                                    .querySelector(
                                        '[data-automation-id="product-title"]'
                                    )
                                    ?.textContent?.trim() ||
                                tile
                                    .querySelector(
                                        'span[data-automation-id="product-title"]'
                                    )
                                    ?.textContent?.trim() ||
                                tile
                                    .querySelector("a span")
                                    ?.textContent?.trim() ||
                                "N/A";

                            const priceElement =
                                tile.querySelector(
                                    '[data-automation-id="product-price"] span'
                                ) ||
                                tile.querySelector(
                                    'div[data-automation-id="product-price"]'
                                ) ||
                                tile.querySelector(
                                    'span[class*="price-characteristic"]'
                                ) ||
                                tile.querySelector('span[class*="price"]');

                            const price =
                                priceElement?.textContent?.trim() || "N/A";

                            const linkElement =
                                tile.querySelector("a[link-identifier]") ||
                                tile.querySelector("a");
                            const link = linkElement?.href || "N/A";

                            const ratingContainer = tile.querySelector(
                                '[data-testid="product-ratings"]'
                            );
                            let rating = "N/A";

                            if (ratingContainer) {
                                const ariaLabel =
                                    ratingContainer.getAttribute("aria-label");
                                if (ariaLabel) {
                                    const ratingMatch =
                                        ariaLabel.match(/(\d+\.?\d*)\s*out of/);
                                    if (ratingMatch) {
                                        rating = ratingMatch[1];
                                    }
                                } else {
                                    const allStars =
                                        ratingContainer.querySelectorAll("svg");
                                    let fullStars = 0;
                                    let hasHalfStar = false;

                                    allStars.forEach((star) => {
                                        if (star.classList.contains("w_HGbC")) {
                                            hasHalfStar = true;
                                        } else if (
                                            star.classList.contains("w_1jp4")
                                        ) {
                                            fullStars++;
                                        }
                                    });

                                    if (hasHalfStar) {
                                        rating = (fullStars - 0.5).toFixed(1);
                                    } else if (fullStars > 0) {
                                        rating = fullStars.toFixed(1);
                                    }
                                }
                            }

                            const imageLink = tile.querySelector(
                                '[data-automation-id="productTileImage"] span'
                            );
                            const image =
                                imageLink?.getAttribute("src") || "N/A";

                            return {
                                title,
                                price,
                                rating,
                                image,
                                link: link.startsWith("/")
                                    ? `https://www.walmart.com${link}`
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

                const nextPageButton = await page.$('[data-testid="NextPage"]');

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
                const escapedTitle = `"${product.title.replace(/"/g, '""')}"`;
                const escapedLink = `"${product.link.replace(/"/g, '""')}"`;
                const escapedCategory = `"${product.category.replace(
                    /"/g,
                    '""'
                )}"`;
                return `${escapedTitle},${product.price},${product.rating},${escapedCategory},${escapedLink}`;
            })
            .join("\n");

        const fullCsvContent = csvHeader + csvContent;

        const filename = `Walmart-exported.csv`;
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
