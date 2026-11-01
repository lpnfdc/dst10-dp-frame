(() => {
  const appScriptUrl = document.currentScript && document.currentScript.src;
  const captionsUrl = appScriptUrl
    ? new URL("./assets/captions.json", appScriptUrl)
    : new URL("./assets/captions.json", document.baseURI);
  const MAX_FILE_SIZE = 15 * 1024 * 1024;
  const allowedTypes = new Set(["image/jpeg", "image/png", "image/webp"]);
  // Bounds of the transparent photo opening in assets/overlay.png.
  const photoWindow = {
    left: 193 / 1440,
    top: 193 / 1440,
    right: 1247 / 1440,
    bottom: 1247 / 1440
  };
  const photoInput = document.getElementById("photoInput");
  const dropzone = document.getElementById("dropzone");
  const canvas = document.getElementById("resultCanvas");
  const context = canvas.getContext("2d");
  const downloadButton = document.getElementById("downloadButton");
  const message = document.getElementById("message");
  const photoDetails = document.getElementById("photoDetails");
  const emptyPreview = document.getElementById("emptyPreview");
  const statusPill = document.getElementById("statusPill");
  const photoAdjustments = document.getElementById("photoAdjustments");
  const zoomInput = document.getElementById("zoomInput");
  const horizontalInput = document.getElementById("horizontalInput");
  const verticalInput = document.getElementById("verticalInput");
  const eventOverlay = new Image();
  const captionDialog = document.getElementById("captionDialog");
  const captionText = document.getElementById("captionText");
  const captionStatus = document.getElementById("captionStatus");
  const copyCaptionButton = document.getElementById("copyCaption");

  let currentImage = null;
  let currentOverlay = null;
  let activePhotoUrl = null;
  let currentFileName = "dance-series-track-10";
  let photoLoadId = 0;
  const activePointers = new Map();
  let pinchStartDistance = 0;
  let pinchStartZoom = 100;
  let captionsLoaded = false;

  function setMessage(text) {
    message.textContent = text;
  }

  function formatSize(bytes) {
    return bytes < 1024 * 1024
      ? `${Math.max(1, Math.round(bytes / 1024))} KB`
      : `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  }

  function resetAdjustmentValues() {
    zoomInput.value = "100";
    horizontalInput.value = "0";
    verticalInput.value = "0";
    document.getElementById("zoomValue").value = "100%";
    document.getElementById("horizontalValue").value = "0%";
    document.getElementById("verticalValue").value = "0%";
  }

  function getPointerDistance() {
    const [first, second] = activePointers.values();
    return Math.hypot(second.x - first.x, second.y - first.y);
  }

  function getImageLayout() {
    const size = canvas.width;
    const zoom = Number(zoomInput.value) / 100;
    const scale = Math.max(size / currentImage.naturalWidth, size / currentImage.naturalHeight) * zoom;
    const width = currentImage.naturalWidth * scale;
    const height = currentImage.naturalHeight * scale;
    const windowWidth = size * (photoWindow.right - photoWindow.left);
    const windowHeight = size * (photoWindow.bottom - photoWindow.top);
    const windowCenterX = size * (photoWindow.left + photoWindow.right) / 2;
    const windowCenterY = size * (photoWindow.top + photoWindow.bottom) / 2;
    const travelX = Math.max(0, (width - windowWidth) / 2);
    const travelY = Math.max(0, (height - windowHeight) / 2);

    return {
      size,
      width,
      height,
      travelX,
      travelY,
      x: windowCenterX - width / 2 + Number(horizontalInput.value) / 100 * travelX,
      y: windowCenterY - height / 2 + Number(verticalInput.value) / 100 * travelY
    };
  }

  function movePhoto(deltaX, deltaY) {
    if (!currentImage) return;

    const { size, travelX, travelY } = getImageLayout();
    const canvasBounds = canvas.getBoundingClientRect();
    const pixelsPerCanvasUnit = size / canvasBounds.width;

    if (travelX > 0) {
      horizontalInput.value = String(Math.max(-100, Math.min(100,
        Number(horizontalInput.value) + deltaX * pixelsPerCanvasUnit / travelX * 100)));
      document.getElementById("horizontalValue").value = `${Math.round(Number(horizontalInput.value))}%`;
    }

    if (travelY > 0) {
      verticalInput.value = String(Math.max(-100, Math.min(100,
        Number(verticalInput.value) + deltaY * pixelsPerCanvasUnit / travelY * 100)));
      document.getElementById("verticalValue").value = `${Math.round(Number(verticalInput.value))}%`;
    }

    drawFrame();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (!currentImage) return;
    event.preventDefault();
    canvas.setPointerCapture(event.pointerId);
    activePointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (activePointers.size === 1) {
      canvas.classList.add("is-dragging");
    } else if (activePointers.size === 2) {
      pinchStartDistance = getPointerDistance();
      pinchStartZoom = Number(zoomInput.value);
    }
  });

  canvas.addEventListener("pointermove", (event) => {
    if (!activePointers.has(event.pointerId)) return;
    event.preventDefault();
    const previousPosition = activePointers.get(event.pointerId);
    const currentPosition = { x: event.clientX, y: event.clientY };
    activePointers.set(event.pointerId, currentPosition);

    if (activePointers.size >= 2) {
      const currentDistance = getPointerDistance();
      if (pinchStartDistance === 0) {
        if (currentDistance > 0) {
          pinchStartDistance = currentDistance;
          pinchStartZoom = Number(zoomInput.value);
        }
        return;
      }

      const zoom = Math.max(100, Math.min(300,
        Math.round(pinchStartZoom * currentDistance / pinchStartDistance)));
      zoomInput.value = String(zoom);
      document.getElementById("zoomValue").value = `${zoom}%`;
      drawFrame();
      return;
    }

    if (previousPosition) {
      movePhoto(currentPosition.x - previousPosition.x, currentPosition.y - previousPosition.y);
    }
  });

  function endPointer(event) {
    activePointers.delete(event.pointerId);

    if (activePointers.size === 1) {
      pinchStartDistance = 0;
    } else if (activePointers.size === 0) {
      pinchStartDistance = 0;
      canvas.classList.remove("is-dragging");
    } else {
      pinchStartDistance = getPointerDistance();
      pinchStartZoom = Number(zoomInput.value);
    }
  }

  canvas.addEventListener("pointerup", endPointer);
  canvas.addEventListener("pointercancel", endPointer);
  canvas.addEventListener("lostpointercapture", endPointer);

  function drawFrame() {
    if (!currentImage || !context) return;

    const { size, width, height, x, y } = getImageLayout();

    context.clearRect(0, 0, size, size);
    context.drawImage(currentImage, x, y, width, height);

    if (currentOverlay) {
      context.drawImage(currentOverlay, 0, 0, size, size);
    }

    canvas.classList.add("is-visible");
    emptyPreview.hidden = true;
    photoAdjustments.classList.add("is-visible");
    downloadButton.disabled = false;
    statusPill.textContent = "Preview ready";
    statusPill.classList.add("is-ready");
  }

  function clearPhoto() {
    photoLoadId++;
    currentImage = null;
    photoInput.value = "";
    resetAdjustmentValues();

    if (activePhotoUrl) {
      URL.revokeObjectURL(activePhotoUrl);
      activePhotoUrl = null;
    }

    context.clearRect(0, 0, canvas.width, canvas.height);
    canvas.classList.remove("is-visible");
    emptyPreview.hidden = false;
    photoDetails.classList.remove("is-visible");
    photoAdjustments.classList.remove("is-visible");
    dropzone.style.display = "";
    downloadButton.disabled = true;
    statusPill.textContent = "Waiting for photo";
    statusPill.classList.remove("is-ready");
    setMessage("");
  }

  function loadPhoto(file) {
    setMessage("");
    if (!file) return;
    if (!allowedTypes.has(file.type)) {
      setMessage("Please choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_FILE_SIZE) {
      setMessage("That photo is over 15 MB. Choose a smaller image.");
      return;
    }

    const thisLoad = ++photoLoadId;
    if (activePhotoUrl) URL.revokeObjectURL(activePhotoUrl);
    const objectUrl = URL.createObjectURL(file);
    activePhotoUrl = objectUrl;
    const image = new Image();

    image.onload = () => {
      if (thisLoad !== photoLoadId) return;
      currentImage = image;
      resetAdjustmentValues();
      currentFileName = file.name.replace(/\.[^.]+$/, "") || "dance-series-track-10";
      document.getElementById("fileName").textContent = file.name;
      document.getElementById("fileSize").textContent = `${formatSize(file.size)} · Ready to frame`;
      photoDetails.classList.add("is-visible");
      dropzone.style.display = "none";
      drawFrame();
    };

    image.onerror = () => {
      if (thisLoad !== photoLoadId) return;
      setMessage("We couldn’t open that image. Try another photo.");
      URL.revokeObjectURL(objectUrl);
      if (activePhotoUrl === objectUrl) activePhotoUrl = null;
    };

    image.src = objectUrl;
  }

  async function copyText(text, statusElement) {
    try {
      await navigator.clipboard.writeText(text);
      statusElement.textContent = "Copied!";
    } catch (error) {
      statusElement.textContent = "Clipboard access is unavailable. Select the caption text and copy it.";
      captionText.focus();
      captionText.select();
    }
  }

  async function showCaptions() {
    captionDialog.showModal();
    captionStatus.textContent = "";
    if (captionsLoaded) return;

    copyCaptionButton.disabled = true;
    captionText.value = "Loading caption…";

    try {
      const response = await fetch(captionsUrl, { cache: "no-cache" });
      if (!response.ok) {
        throw new Error(`Caption file request failed with status ${response.status} at ${response.url}.`);
      }

      const data = await response.json();
      if (!data || typeof data.text !== "string" || !data.text.trim()) {
        throw new Error("Caption file must contain non-empty caption text.");
      }

      captionText.value = data.text;
      captionsLoaded = true;
      copyCaptionButton.disabled = false;
    } catch (error) {
      console.error("Could not load the event captions.", error);
      captionText.value = "The caption couldn’t be loaded. Check that the assets folder and captions.json are included in your GitHub Pages deployment, then try again.";
      copyCaptionButton.disabled = true;
    }
  }

  document.getElementById("reviewCaptions").addEventListener("click", showCaptions);
  document.getElementById("closeCaptions").addEventListener("click", () => captionDialog.close());
  document.getElementById("copyCaption").addEventListener("click", () => {
    if (captionsLoaded) copyText(captionText.value, captionStatus);
  });
  captionDialog.addEventListener("click", (event) => {
    if (event.target === captionDialog) captionDialog.close();
  });

  photoInput.addEventListener("change", () => {
    loadPhoto(photoInput.files && photoInput.files[0]);
    photoInput.value = "";
  });

  document.getElementById("changePhoto").addEventListener("click", () => photoInput.click());
  document.getElementById("removePhoto").addEventListener("click", clearPhoto);
  document.getElementById("resetAdjustments").addEventListener("click", () => {
    resetAdjustmentValues();
    drawFrame();
  });

  zoomInput.addEventListener("input", () => {
    document.getElementById("zoomValue").value = `${zoomInput.value}%`;
    drawFrame();
  });
  horizontalInput.addEventListener("input", () => {
    document.getElementById("horizontalValue").value = `${horizontalInput.value}%`;
    drawFrame();
  });
  verticalInput.addEventListener("input", () => {
    document.getElementById("verticalValue").value = `${verticalInput.value}%`;
    drawFrame();
  });

  dropzone.addEventListener("dragover", (event) => {
    event.preventDefault();
    dropzone.classList.add("is-over");
  });
  dropzone.addEventListener("dragleave", (event) => {
    if (!dropzone.contains(event.relatedTarget)) dropzone.classList.remove("is-over");
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    dropzone.classList.remove("is-over");
    loadPhoto(event.dataTransfer && event.dataTransfer.files[0]);
  });

  downloadButton.addEventListener("click", () => {
    if (!currentImage) return;
    canvas.toBlob((blob) => {
      if (!blob) {
        setMessage("Your image couldn’t be exported. Please try again.");
        return;
      }

      const downloadUrl = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = downloadUrl;
      link.download = `${currentFileName}-dance-series.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(downloadUrl), 1000);
      showCaptions();
    }, "image/png");
  });

  eventOverlay.onload = () => {
    if (eventOverlay.naturalWidth !== eventOverlay.naturalHeight) return;
    currentOverlay = eventOverlay;
    drawFrame();
  };
  eventOverlay.src = "assets/overlay.png";
})();
