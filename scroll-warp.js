// spaceship scroll warp effect

document.addEventListener('scroll', function() {
    const scrollTop = window.pageYOffset;
    const body = document.body;
    const html = document.documentElement;
    const docHeight = Math.max(body.scrollHeight, body.offsetHeight, html.clientHeight, html.scrollHeight, html.offsetHeight);
    const winHeight = window.innerHeight;
    const scrollPercentage = scrollTop / (docHeight - winHeight);

    // Adjusting the spaceship warp effect
    const warpEffect = Math.sin(scrollPercentage * Math.PI) * 20;
    body.style.transform = `translateY(${warpEffect}px)`;
});
