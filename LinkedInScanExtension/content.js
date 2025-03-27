function addScanButtons() {
    document.querySelectorAll(".feed-shared-update-v2").forEach(post => {
        if (!post.querySelector(".scan-button")) {
            let button = document.createElement("button");
            button.innerText = "Spam/Real Post Scan";
            button.className = "scan-button";
            button.style.cssText = "background-color: #0073b1; color: white; padding: 8px; border-radius: 5%; border:none cursor: pointer; margin: 5px;";

            button.addEventListener("click", () => {
                let postText = post.innerText;
                alert("Scanning: " + postText); 
            });

            post.appendChild(button); // post ke sath button ko add 
        }
    });
}

addScanButtons();

// Observe for dynamically loaded posts

// observe krna dynamically loaded post ko.
const observer = new MutationObserver(addScanButtons);
observer.observe(document.body, { childList: true, subtree: true });
