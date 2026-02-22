// AOS (Animate On Scroll) library code

// Initialize AOS
AOS.init({
  duration: 1200, // duration of animations
  easing: 'ease-in-out', // easing function for animations
  once: true, // whether animation should happen only once - while scrolling down
  mirror: false, // whether elements should animate out while scrolling past them
  startEvent: 'DOMContentLoaded', // event that initializes the library
  useIntersectionObserver: true // leverage IntersectionObserver for triggering animations
});

// Animation triggers for various elements
const fadeInElements = document.querySelectorAll('[data-aos="fade-in"]');
const slideInElements = document.querySelectorAll('[data-aos="slide-in"]');

fadeInElements.forEach(element => {
  element.addEventListener('aos:in', () => {
    console.log('Element fades in: ', element);
  });
});

slideInElements.forEach(element => {
  element.addEventListener('aos:in', () => {
    console.log('Element slides in: ', element);
  });
});

// Add parallax effects to elements with 'data-aos' attributes
const parallaxElements = document.querySelectorAll('[data-aos="parallax"]');
parallaxElements.forEach(element => {
  window.addEventListener('scroll', () => {
    const scrollPosition = window.scrollY;
    element.style.transform = `translateY(${scrollPosition * 0.5}px)`; // Adjust parallax effect
  });
});
