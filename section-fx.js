// section-fx.js

// Function to apply visual enhancements to a section
document.addEventListener('DOMContentLoaded', function() {
    const section = document.querySelector('.my-section');
    if(section) {
        // Apply some visual effects
        section.style.transition = 'all 0.3s ease';
        section.onmouseover = () => {
            section.style.transform = 'scale(1.05)';
            section.style.boxShadow = '0 4px 8px rgba(0,0,0,0.2)';
        };
        section.onmouseout = () => {
            section.style.transform = 'scale(1)';
            section.style.boxShadow = 'none';
        };
    }
});
