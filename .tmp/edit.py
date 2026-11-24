p='tests/e2e/review.spec.js'
s=open(p).read()
def r(a,b,n=1):
    global s
    assert s.count(a)==n,(s.count(a),a)
    s=s.replace(a,b)
r("""		// Translucent, until the mouse is over it
		const back = () => marker.evaluate((element) => getComputedStyle(element).backgroundColor)
		await page.mouse.move(0, 0)
		await page.locator('.deliver-layout__bar h2').click()
		await page.evaluate(() => document.activeElement.blur())
		await expect.poll(back)""","""		// Translucent, until the mouse is over it
		const back = () => marker.evaluate((element) => getComputedStyle(element).backgroundColor)
		await open(page, '1 min')
		await page.mouse.move(0, 0)
		await expect.poll(back)""")
open(p,'w').write(s)
