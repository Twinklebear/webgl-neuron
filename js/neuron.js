var cubeStrip = [
    1, 1, 0,
    0, 1, 0,
    1, 1, 1,
    0, 1, 1,
    0, 0, 1,
    0, 1, 0,
    0, 0, 0,
    1, 1, 0,
    1, 0, 0,
    1, 1, 1,
    1, 0, 1,
    0, 0, 1,
    1, 0, 0,
    0, 0, 0
];

var gl = null;
var canvas = null;

var neurons = [];
var swcShader = null;

var highlightTrace = null;
var highlightErrors = null;
var showVolume = null;
var volumeThreshold = null;
var saturationThreshold = null;

var loadingProgressText = null;
var loadingProgressBar = null;
var voxelSpacingInputs = null;
var voxelSpacingFromURL = false;
var volumeURL = null;

var renderTargets = null;
var depthColorFbo = null
var colorFbo = null;
var blitImageShader = null;

var shader = null;
var volumeTexture = null;
var volumeLoaded = false;
var volumeVao = null;
var volDims = null;
var volValueRange = [0, 1];
var volumeIsInt = 0;

var colormapTex = null;
var fileRegex = /(\w+)_(\d+)x(\d+)x(\d+)_(\w+)\.*/;
var proj = null;
var camera = null;
var projView = null;
var tabFocused = true;
var newVolumeUpload = true;
var targetFrameTime = 32;
var samplingRate = 1.0;
var WIDTH = 640;
var HEIGHT = 480;

const defaultEye = vec3.set(vec3.create(), 0.5, 0.5, 1.5);
const center = vec3.set(vec3.create(), 0.5, 0.5, 0.5);
const up = vec3.set(vec3.create(), 0.0, 1.0, 0.0);

var volumes = {
    "DIADEM NC Layer 1 Axons": "neocortical_layer_1_axons_1464x1033x76_uint8.raw",
};

var colormaps = {
    "Grayscale": "colormaps/grayscale.png",
    "Cool Warm": "colormaps/cool-warm-paraview.png",
    "Matplotlib Plasma": "colormaps/matplotlib-plasma.png",
    "Matplotlib Virdis": "colormaps/matplotlib-virdis.png",
    "Rainbow": "colormaps/rainbow.png",
    "Samsel Linear Green": "colormaps/samsel-linear-green.png",
    "Samsel Linear YGB 1211G": "colormaps/samsel-linear-ygb-1211g.png",
};

var getVoxelSpacing = function() {
    var spacing = [1, 1, 1];
    for (var i = 0; i < 3; ++i) {
        try {
            spacing[i] = parseFloat(voxelSpacingInputs[i].value);
            if (spacing[i] < 1) {
                spacing[i] = 1;
            }
            voxelSpacingInputs[i].value = spacing[i];
        } catch (e) {
            spacing[i] = 1;
        }
    }
    return spacing;
}

var buildShareURL = function() {
    window.location.hash = "";
    if (volumeURL) {
        window.location.hash += "url=" + volumeURL + "&";
    }

    var spacing = getVoxelSpacing();
    if (spacing[0] != 1 || spacing[1] != 1 || spacing[2] != 1) {
        window.location.hash += "vox=" + spacing[0] + "x" + spacing[1] + "x" + spacing[2] + "&";
    }

    window.location.hash += "thresh=" + volumeThreshold.value + "&";
    window.location.hash += "sat=" + saturationThreshold.value + "&";

    var selection = document.getElementById("colormapList").value;
    if (selection == "Grayscale") {
        window.location.hash += "cmap=" + 1;
    } else if (selection == "Cool Warm") {
        window.location.hash += "cmap=" + 2;
    } else if (selection == "Matplotlib Plasma") {
        window.location.hash += "cmap=" + 3;
    } else if (selection == "Matplotlib Virdis") {
        window.location.hash += "cmap=" + 4;
    } else if (selection == "Rainbow") {
        window.location.hash += "cmap=" + 5;
    } else if (selection == "Samsel Linear Green") {
        window.location.hash += "cmap=" + 6;
    } else if (selection == "Samsel Linear YGB 1211G") {
        window.location.hash += "cmap=" + 7;
    }
    var showURL = document.getElementById("shareURL");
    showURL.setAttribute("style", "display:block");
    showURL.innerText = window.location;
}

var loadRAWVolume = function(file, onload) {
    // Only one raw volume here anyway
    document.getElementById("volumeName").innerHTML = "Volume: DIADEM NC Layer 1 Axons";

    var m = file.match(fileRegex);
    volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];

    var url = "https://cdn.willusher.io/webgl-neuron-data/" + file;
    var req = new XMLHttpRequest();

    loadingProgressText.innerHTML = "Loading Volume";
    loadingProgressBar.setAttribute("style", "width: 0%");

    if (!voxelSpacingFromURL) {
        for (var i = 0; i < 3; ++i) {
            voxelSpacingInputs[i].value = 1;
        }
    }

    req.open("GET", url, true);
    req.responseType = "arraybuffer";
    req.onprogress = function(evt) {
        var vol_size = volDims[0] * volDims[1] * volDims[2];
        var percent = evt.loaded / vol_size * 100;
        loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
    };
    req.onerror = function(evt) {
        loadingProgressText.innerHTML = "Error Loading Volume";
        loadingProgressBar.setAttribute("style", "width: 0%");
    };
    req.onload = function(evt) {
        loadingProgressText.innerHTML = "Loaded Volume";
        loadingProgressBar.setAttribute("style", "width: 101%");
        var dataBuffer = req.response;
        if (dataBuffer) {
            dataBuffer = new Uint8Array(dataBuffer);
            var m = file.match(fileRegex);

            volumeIsInt = 0;
            volumeLoaded = false;
            if (volumeTexture) {
                gl.deleteTexture(volumeTexture);
            }
            volumeTexture = gl.createTexture();
            gl.activeTexture(gl.TEXTURE0);
            gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
            gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, volDims[0], volDims[1], volDims[2]);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
            gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
            gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0,
                volDims[0], volDims[1], volDims[2],
                gl.RED, gl.UNSIGNED_BYTE, dataBuffer);

            volValueRange = [0, 1];
            volumeLoaded = true;
            newVolumeUpload = true;
            document.getElementById("tiffUploadBox").style = "display:block";
        } else {
            alert("Unable to load buffer properly from volume?");
        }
    };
    req.send();
}

var num_diff_segment_vertices = 0;
var diff_segments_vao = null;
var diff_segments_vbo = null;

var renderLoop = function() {
    // Save them some battery if they're not viewing the tab
    if (document.hidden) {
        return;
    }
    if (!volumeLoaded) {
        gl.bindFramebuffer(gl.FRAMEBUFFER, null);
        gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
        return;
    }

    // Reset the sampling rate and camera for new volumes
    if (newVolumeUpload) {
        camera = new ArcballCamera(defaultEye, center, up, 1, [WIDTH, HEIGHT]);
        samplingRate = 1.0;
        shader.use(gl);
        gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
    }

    var startTime = performance.now();

    projView = mat4.mul(projView, proj, camera.camera);
    var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];

    var longestAxis = Math.max(volDims[0], Math.max(volDims[1], volDims[2]));
    var voxelSpacing = getVoxelSpacing();
    var volScale = [volDims[0] / longestAxis * voxelSpacing[0],
        volDims[1] / longestAxis * voxelSpacing[1],
        volDims[2] / longestAxis * voxelSpacing[2]];

    // Render any SWC files we have
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthColorFbo);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (neurons.length > 0) {
        swcShader.use(gl);
        gl.uniform1i(swcShader.uniforms["volume"], 0);
        gl.uniform1i(swcShader.uniforms["ivolume"], 5);
        gl.uniform2fv(swcShader.uniforms["value_range"], volValueRange);
        gl.uniform1i(swcShader.uniforms["volume_is_int"], volumeIsInt);
        gl.uniform1i(swcShader.uniforms["highlight_errors"], highlightErrors.checked);

        gl.uniform3iv(swcShader.uniforms["volume_dims"], volDims);
        gl.uniform3fv(swcShader.uniforms["volume_scale"], volScale);
        gl.uniformMatrix4fv(swcShader.uniforms["proj_view"], false, projView);

        for (var i = 0; i < neurons.length; ++i) {
            var swc = neurons[i];
            if (!swc.visible.checked) {
                continue;
            }

            // Upload new SWC files
            if (swc.vao == null) {
                swc.vao = gl.createVertexArray();
                gl.bindVertexArray(swc.vao);

                swc.vbo = gl.createBuffer();
                gl.bindBuffer(gl.ARRAY_BUFFER, swc.vbo);
                gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(swc.points), gl.STATIC_DRAW);
                gl.enableVertexAttribArray(0);
                gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

                swc.ebo = gl.createBuffer();
                gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, swc.ebo);
                gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(swc.indices), gl.STATIC_DRAW);
            }

            var color = hexToRGBf(swc.color.value);
            gl.uniform3fv(swcShader.uniforms["swc_color"], color);

            // Draw the SWC file
            gl.bindVertexArray(swc.vao);
            for (var j = 0; j < swc.branches.length; ++j) {
                var b = swc.branches[j];
                gl.drawElements(gl.LINE_STRIP, b["count"], gl.UNSIGNED_SHORT, 2 * b["start"]);
            }
        }
    }

    if (num_diff_segment_vertices > 0) {
        swcShader.use(gl);
        gl.uniform3iv(swcShader.uniforms["volume_dims"], volDims);
        gl.uniform3fv(swcShader.uniforms["volume_scale"], volScale);
        gl.uniformMatrix4fv(swcShader.uniforms["proj_view"], false, projView);
        gl.uniform3fv(swcShader.uniforms["swc_color"], [1.0, 0.0, 0.0]);

        gl.bindVertexArray(diff_segments_vao);
        gl.drawArrays(gl.LINES, 0, num_diff_segment_vertices);
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
    if (volumeLoaded && showVolume.checked) {
        gl.activeTexture(gl.TEXTURE4);
        gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);
        shader.use(gl);
        gl.uniform2fv(shader.uniforms["value_range"], volValueRange);
        gl.uniform3iv(shader.uniforms["volume_dims"], volDims);
        gl.uniform3fv(shader.uniforms["volume_scale"], volScale);
        gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
        gl.uniformMatrix4fv(shader.uniforms["inv_proj"], false, invProj);
        gl.uniform1i(shader.uniforms["volume_is_int"], volumeIsInt);

        var invView = mat4.invert(mat4.create(), camera.camera);
        gl.uniformMatrix4fv(shader.uniforms["inv_view"], false, invView);
        gl.uniform3fv(shader.uniforms["eye_pos"], eye);
        gl.uniform1i(shader.uniforms["highlight_trace"], highlightTrace.checked);
        gl.uniform1f(shader.uniforms["threshold"], volumeThreshold.value);
        gl.uniform1f(shader.uniforms["saturation_threshold"], saturationThreshold.value);

        gl.bindVertexArray(volumeVao);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);
    }

    // Seems like we can't blit the framebuffer b/c the default draw fbo might be
    // using multiple samples?
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.disable(gl.BLEND);
    gl.disable(gl.CULL_FACE);
    blitImageShader.use(gl);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.CULL_FACE);
    gl.enable(gl.BLEND);

    // Wait for rendering to actually finish
    gl.finish();
    var endTime = performance.now();
    var renderTime = endTime - startTime;
    var targetSamplingRate = renderTime / targetFrameTime;

    // If we're dropping frames, decrease the sampling rate, or if we're
    // rendering faster try increasing it to provide better quality
    if (!newVolumeUpload) {
        // Chrome doesn't actually wait for gl.finish to return
        if (targetSamplingRate > 0.8) {
            samplingRate = 0.9 * samplingRate + 0.1 * targetSamplingRate;
            shader.use(gl);
            gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
        }
    }
    newVolumeUpload = false;
    startTime = endTime;
}

var selectColormap = function() {
    var selection = document.getElementById("colormapList").value;
    var colormapImage = new Image();
    colormapImage.onload = function() {
        gl.activeTexture(gl.TEXTURE1);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1,
            gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);
    };
    colormapImage.src = colormaps[selection];
}

window.onload = function() {
    fillcolormapSelector();

    highlightTrace = document.getElementById("highlightTrace");
    highlightErrors = document.getElementById("highlightErrors");
    highlightErrors.checked = false;

    showVolume = document.getElementById("showVolume");
    showVolume.checked = true;

    volumeThreshold = document.getElementById("threshold");
    volumeThreshold.value = 0.1;

    saturationThreshold = document.getElementById("saturationThreshold");
    saturationThreshold.value = 1;

    loadingProgressText = document.getElementById("loadingText");
    loadingProgressBar = document.getElementById("loadingProgressBar");

    canvas = document.getElementById("glcanvas");

    // For some random JS/HTML reason it won't find the function if it's not set here
    document.getElementById("fetchTIFFButton").onclick = fetchTIFF;
    document.getElementById("uploadSWC").onchange = uploadSWC;
    document.getElementById("shareURLButton").onclick = buildShareURL;

    voxelSpacingInputs = [
        document.getElementById("voxelSpacingX"),
        document.getElementById("voxelSpacingY"),
        document.getElementById("voxelSpacingZ")
    ];

    if (window.location.hash) {
        var regexResolution = /(\d+)x(\d+)/;
        var regexVoxelSpacing = /(\d+\.?\d?)x(\d+\.?\d?)x(\d+\.?\d?)/;
        var urlParams = window.location.hash.substr(1).split("&");
        for (var i = 0; i < urlParams.length; ++i) {
            var str = decodeURI(urlParams[i]);
            console.log(str);
            // URL load param
            if (str.startsWith("url=")) {
                volumeURL = str.substr(4);
                continue;
            }
            // Volume threshold
            if (str.startsWith("thresh=")) {
                volumeThreshold.value = clamp(parseFloat(str.substr(7)), 0, 1);
                continue;
            }
            // Saturation threshold 
            if (str.startsWith("sat=")) {
                saturationThreshold.value = clamp(parseFloat(str.substr(4)), 0, 1);
                continue;
            }
            // Voxel Spacing
            if (str.startsWith("vox=")) {
                var m = str.substr(4).match(regexVoxelSpacing);
                voxelSpacingFromURL = true;
                voxelSpacingInputs[0].value = Math.max(parseFloat(m[1]), 1);
                voxelSpacingInputs[1].value = Math.max(parseFloat(m[2]), 1);
                voxelSpacingInputs[2].value = Math.max(parseFloat(m[3]), 1);
                continue;
            }
            // Colormap
            if (str.startsWith("cmap=")) {
                var cmap = parseInt(str.substr(5));
                var selector = document.getElementById("colormapList");
                selector.value = "Grayscale";
                if (cmap == 2) {
                    selector.value = "Cool Warm";
                } else if (cmap == 3) {
                    selector.value = "Matplotlib Plasma";
                } else if (cmap == 4) {
                    selector.value = "Matplotlib Virdis";
                } else if (cmap == 5) {
                    selector.value = "Rainbow";
                } else if (cmap == 6) {
                    selector.value = "Samsel Linear Green";
                } else if (cmap == 7) {
                    selector.value = "Samsel Linear YGB 1211G";
                }
                continue;
            }
            // When embedding as an iframe, go hide the UI text and leave just the controls
            if (str == "embed") {
                document.getElementById("viewerTitle").setAttribute("style", "display:none");
                document.getElementById("shareURLUI").setAttribute("style", "display:none");
                document.getElementById("uiText").setAttribute("style", "display:none");
                document.getElementById("loadDiademReference").setAttribute("style", "display:none");
            }
            if (str == "embedMinimal") {
                document.getElementById("viewerTitle").setAttribute("style", "display:none");
                document.getElementById("shareURLUI").setAttribute("style", "display:none");
                document.getElementById("uiText").setAttribute("style", "display:none");
                document.getElementById("loadDiademReference").setAttribute("style", "display:none");
                document.getElementById("hideEmbedMinimal").setAttribute("style", "display:none");
            }
            // Canvas dimensions 
            var m = str.match(regexResolution);
            if (m) {
                WIDTH = parseInt(m[1]);
                HEIGHT = parseInt(m[2]);
                canvas.width = WIDTH;
                canvas.height = HEIGHT;
                canvas.className = "";
            }
        }
    }

    gl = canvas.getContext("webgl2");
    if (!gl) {
        alert("Unable to initialize WebGL2. Your browser may not support it");
        return;
    }
    WIDTH = canvas.getAttribute("width");
    HEIGHT = canvas.getAttribute("height");

    proj = mat4.perspective(mat4.create(), 60 * Math.PI / 180.0,
        WIDTH / HEIGHT, 0.01, 100);
    invProj = mat4.invert(mat4.create(), proj);

    camera = new ArcballCamera(defaultEye, center, up, 1, [WIDTH, HEIGHT]);
    projView = mat4.create();

    // Register mouse and touch listeners
    var controller = new Controller();
    controller.mousemove = function(prev, cur, evt) {
        if (evt.buttons == 1) {
            camera.rotate(prev, cur);
        } else if (evt.buttons == 2) {
            camera.pan([cur[0] - prev[0], prev[1] - cur[1]]);
        }
    };
    controller.wheel = function(amt) { camera.zoom(amt); };
    controller.pinch = controller.wheel;
    controller.twoFingerDrag = function(drag) { camera.pan(drag); };

    controller.registerForCanvas(canvas);

    // Setup VAO and VBO to render the cube to run the raymarching shader
    volumeVao = gl.createVertexArray();
    gl.bindVertexArray(volumeVao);

    var vbo = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(cubeStrip), gl.STATIC_DRAW);

    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

    blitImageShader = new Shader(gl, quadVertShader, quadFragShader);
    blitImageShader.use(gl);
    gl.uniform1i(blitImageShader.uniforms["colors"], 3);

    swcShader = new Shader(gl, swcVertShader, swcFragShader);

    shader = new Shader(gl, vertShader, fragShader);
    shader.use(gl);

    gl.uniform1i(shader.uniforms["volume"], 0);
    gl.uniform1i(shader.uniforms["ivolume"], 5);
    gl.uniform1i(shader.uniforms["colormap"], 1);
    gl.uniform1i(shader.uniforms["depth"], 4);
    gl.uniform1f(shader.uniforms["dt_scale"], 1.0);
    gl.uniform2iv(shader.uniforms["canvas_dims"], [WIDTH, HEIGHT]);

    // Setup required OpenGL state for drawing the back faces and
    // composting with the background color
    gl.enable(gl.CULL_FACE);
    gl.cullFace(gl.FRONT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    gl.clearColor(0.01, 0.01, 0.01, 1.0);
    gl.clearDepth(1.0);

    // Setup the render targets for the splat rendering pass
    renderTargets = [gl.createTexture(), gl.createTexture()]
    gl.bindTexture(gl.TEXTURE_2D, renderTargets[0]);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, WIDTH, HEIGHT);

    gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.DEPTH_COMPONENT32F, WIDTH, HEIGHT);

    for (var i = 0; i < 2; ++i) {
        gl.bindTexture(gl.TEXTURE_2D, renderTargets[i]);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    }

    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, renderTargets[0]);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);

    depthColorFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthColorFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, renderTargets[0], 0);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
        gl.TEXTURE_2D, renderTargets[1], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    colorFbo = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, colorFbo);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D, renderTargets[0], 0);
    gl.drawBuffers([gl.COLOR_ATTACHMENT0]);

    // Load the default colormap and upload it, after which we
    // load the default volume.
    var colormapImage = new Image();
    colormapImage.onload = function() {
        var colormap = gl.createTexture();
        gl.activeTexture(gl.TEXTURE1);
        gl.bindTexture(gl.TEXTURE_2D, colormap);
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.SRGB8_ALPHA8 , 180, 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1,
            gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);


        if (volumeURL) {
            fetchTIFFURL(volumeURL);
            document.getElementById("tiffUploadBox").style = "display:block";
        } else {
            loadRAWVolume(volumes["DIADEM NC Layer 1 Axons"]);
        }
        setInterval(renderLoop, targetFrameTime);
    };
    colormapImage.src = colormaps[document.getElementById("colormapList").value];
}

var fillcolormapSelector = function() {
    var selector = document.getElementById("colormapList");
    for (p in colormaps) {
        var opt = document.createElement("option");
        opt.value = p;
        opt.innerHTML = p;
        selector.appendChild(opt);
    }
}

var TIFFGLFormat = function(sampleFormat, bytesPerSample) {
    // For neuron data I doubt they'll have negative vals, so just treat "int" as uint
    if (sampleFormat === TiffSampleFormat.UINT
        || sampleFormat == TiffSampleFormat.UNSPECIFIED
        || sampleFormat == TiffSampleFormat.INT)
    {
        if (bytesPerSample == 1) {
            return gl.R8;
        } else if (bytesPerSample == 2) {
            return gl.R16UI
        }
    }
    alert("Unsupported TIFF Format, only 8 & 16 bit uint are supported");
}

var makeTIFFGLVolume = function(tiff) {
    var imgFormat = TIFFGetField(tiff, TiffTag.SAMPLEFORMAT);
    var bytesPerSample = TIFFGetField(tiff, TiffTag.BITSPERSAMPLE) / 8;
    var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
    var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);

    if (!voxelSpacingFromURL) {
        for (var i = 0; i < 3; ++i) {
            voxelSpacingInputs[i].value = 1;
        }
    }

    var description = TIFFGetStringField(tiff, TiffTag.IMAGEDESCRIPTION);
    if (!voxelSpacingFromURL && description) {
        var findSpacing = /spacing=(\d+)/;
        var m = description.match(findSpacing);
        if (m) {
            voxelSpacingInputs[2].value = parseFloat(m[1]);
        }
    }

    var glFormat = TIFFGLFormat(imgFormat, bytesPerSample);
    if (volumeTexture) {
        gl.deleteTexture(volumeTexture);
    }
    if (glFormat == gl.R8) {
        gl.activeTexture(gl.TEXTURE0);
    } else {
        gl.activeTexture(gl.TEXTURE5);
    }
    volumeTexture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    gl.texStorage3D(gl.TEXTURE_3D, 1, glFormat, volDims[0], volDims[1], volDims[2]);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    if (glFormat == gl.R8) {
        volumeIsInt = 0;
        volValueRange[0] = 0;
        volValueRange[1] = 1;
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    } else {
        volumeIsInt = 1;
        // R16 is not normalized/texture filterable so we need to normalize it
        volValueRange[0] = Infinity;
        volValueRange[1] = -Infinity;
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
        gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    }
}

var loadTIFFSlice = function(tiff, z_index, slice_scratch) {
    var bps = TIFFGetField(tiff, TiffTag.BITSPERSAMPLE);

    // We only support single channel images
    if (TIFFGetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
        alert("Only single channel images are supported");
        return;
    }

    var imgFormat = TIFFGetField(tiff, TiffTag.SAMPLEFORMAT);

    var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
    var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);

    var numStrips = TIFFNumberOfStrips(tiff);
    var rowsPerStrip = TIFFGetField(tiff, TiffTag.ROWSPERSTRIP);

    var bytesPerSample = TIFFGetField(tiff, TiffTag.BITSPERSAMPLE) / 8;

    var sbuf = TIFFMalloc(TIFFStripSize(tiff));
    for (var s = 0; s < numStrips; ++s) {
        var read = TIFFReadEncodedStrip(tiff, s, sbuf, -1);
        if (read == -1) {
            alert("Error reading encoded strip from TIFF file " + file);
        }
        // Just make a view into the heap, not a copy
        var stripData = new Uint8Array(Module.HEAPU8.buffer, sbuf, read);
        slice_scratch.set(stripData, s * rowsPerStrip * width * bytesPerSample);
    }
    TIFFFree(sbuf);

    // Flip the image in Y, since TIFF y axis is downwards
    for (var y = 0; y < height / 2; ++y) {
        for (var x = 0; x < width; ++x) {
            for (var b = 0; b < bytesPerSample; ++b) {
                var tmp = slice_scratch[(y * width + x) * bytesPerSample];
                slice_scratch[(y * width + x) * bytesPerSample] =
                    slice_scratch[((height - y - 1) * width + x) * bytesPerSample];
                slice_scratch[((height - y - 1) * width + x) * bytesPerSample] = tmp;
            }
        }
    }

    var glFormat = TIFFGLFormat(imgFormat, bytesPerSample);
    if (glFormat == gl.R8) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z_index,
            width, height, 1, gl.RED, gl.UNSIGNED_BYTE, slice_scratch);
    } else {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
        var u16arr = new Uint16Array(slice_scratch.buffer);
        for (var j = 0; j < u16arr.length; ++j) {
            volValueRange[0] = Math.min(volValueRange[0], u16arr[j]);
            volValueRange[1] = Math.max(volValueRange[1], u16arr[j]);
        }
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z_index,
            width, height, 1, gl.RED_INTEGER, gl.UNSIGNED_SHORT, u16arr);
    }
}

var loadMultipageTiff = function(tiff, numDirectories) {
    TIFFSetDirectory(tiff, 0);
    var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
    var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);
    var bytesPerSample = TIFFGetField(tiff, TiffTag.BITSPERSAMPLE) / 8;
    var slice_scratch = new Uint8Array(width * height * bytesPerSample);
    for (var i = 0; i < numDirectories; ++i) {
        loadTIFFSlice(tiff, i, slice_scratch);
        TIFFReadDirectory(tiff);

        var percent = i / numDirectories * 100;
        loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
    } 

    volumeLoaded = true;
    newVolumeUpload = true;
    loadingProgressText.innerHTML = "Loaded Volume";
    loadingProgressBar.setAttribute("style", "width: 101%");
}

var uploadTIFF = function(files) {
    var showURL = document.getElementById("shareURL").setAttribute("style", "display:none");

    var numLoaded = 0;
    volumeLoaded = false;

    loadingProgressText.innerHTML = "Loading Volume";
    loadingProgressBar.setAttribute("style", "width: 0%");

    var slice_scratch = null;
    var start = performance.now();

    var loadFile = function(i) {
        var file = files[i];
        var reader = new FileReader();
        reader.onerror = function() {
            alert("Error reading TIFF file " + file.name);
        };
        reader.onprogress = function(evt) {
            var percent = numLoaded / files.length * 100;
            loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
        };
        reader.onload = function(evt) {
            var buf = reader.result;
            if (buf) {
                var fname = "temp" + i + ".tiff";
                FS.createDataFile("/", fname, new Uint8Array(reader.result), true, false);
                var tiff = TIFFOpen(fname, "r");

                if (!slice_scratch) {
                    var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
                    var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);
                    var bytesPerSample = TIFFGetField(tiff, TiffTag.BITSPERSAMPLE) / 8;
                    slice_scratch = new Uint8Array(width * height * bytesPerSample);
                }

                loadTIFFSlice(tiff, i, slice_scratch);

                TIFFClose(tiff);
                FS.unlink("/" + fname);

                numLoaded += 1;
                if (numLoaded == files.length) {
                    var end = performance.now();
                    volumeLoaded = true;
                    newVolumeUpload = true;
                    loadingProgressText.innerHTML = "Loaded Volume";
                    loadingProgressBar.setAttribute("style", "width: 101%");
                    console.log(`Loading TIFF took ${end - start}ms`);
                } else {
                    var percent = numLoaded / files.length * 100;
                    loadingProgressBar.setAttribute("style", "width: " + percent.toFixed(2) + "%");
                    // We serialize the loading somewhat to not overload the browser when
                    // trying to upload a lot of files
                    loadFile(i + 1);
                }
            } else {
                alert("Unable to load file " + file.name);
            }
        };
        reader.readAsArrayBuffer(file);
    };

    // First we need to load the first file to get the width, height and color format info
    var reader = new FileReader();
    reader.onerror = function() {
        alert("Error reading TIFF file " + files[0].name);
    };
    reader.onload = function(evt) {
        var buf = reader.result;
        if (buf) {
            FS.createDataFile("/", "temp_test.tiff", new Uint8Array(reader.result), true, false);
            var tiff = TIFFOpen("temp_test.tiff", "r");

            var numDirectories = 0;
            if (!TIFFLastDirectory(tiff)) {
                do {
                    ++numDirectories;
                } while (TIFFReadDirectory(tiff));
                TIFFSetDirectory(tiff, 0);
            }

            // We only support single channel images
            if (TIFFGetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
                alert("Only single channel images are supported");
                return;
            }

            var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
            var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);
            volDims = [width, height, 0];
            if (numDirectories != 0) {
                volDims[2] = numDirectories;

                document.getElementById("volumeName").innerHTML =
                    "Volume: Multi-page '" + files[0].name + "', " + numDirectories + " pages";
            } else {
                volDims[2] = files.length;
                document.getElementById("volumeName").innerHTML =
                    "Volume: Stack '" + files[0].name + "', " + files.length + " slices";
            }

            makeTIFFGLVolume(tiff);

            if (numDirectories == 0) {
                TIFFClose(tiff);
                FS.unlink("/temp_test.tiff");
                loadFile(0);
            } else {
                loadMultipageTiff(tiff, numDirectories);
                TIFFClose(tiff);
                FS.unlink("/temp_test.tiff");
            }
        } else {
            alert("Unable to load file " + file.name);
        }
    };
    reader.readAsArrayBuffer(files[0]);
}

var fetchTIFF = function() {
    var showURL = document.getElementById("shareURL").setAttribute("style", "display:none");
    var url = document.getElementById("fetchTIFF").value;
    voxelSpacingFromURL = false;
    fetchTIFFURL(url);
}

var fetchTIFFURL = function(url) {
    volumeURL = url;
    volumeLoaded = false;

    // Users will paste the shared URL from Dropbox or Google Drive
    // so we need to change it to the direct URL to fetch from
    var dropboxRegex = /.*dropbox.com\/s\/([^?]+)/
    var googleDriveRegex = /.*drive.google.com.*id=([^&]+)/
    var m = url.match(dropboxRegex);
    if (m) {
        url = "https://www.dl.dropboxusercontent.com/s/" + m[1] + "?dl=1";
    } else {
        m = url.match(googleDriveRegex);
        if (m) {
            var GOOGLE_DRIVE_API_KEY = "";
            url = "https://www.googleapis.com/drive/v3/files/" + m[1] +
                "?alt=media&key=" + GOOGLE_DRIVE_API_KEY;
        } else {
            alert("Unsupported/handled URL: " + url);
            return;
        }
    }

    var req = new XMLHttpRequest();

    loadingProgressText.innerHTML = "Loading Volume";
    loadingProgressBar.setAttribute("style", "width: 0%");

    req.open("GET", url, true);
    req.responseType = "arraybuffer";
    req.onerror = function(evt) {
        loadingProgressText.innerHTML = "Error Loading Volume: Does your resource support CORS?";
        loadingProgressBar.setAttribute("style", "width: 0%");
        alert("Failed to load volume at " + url + ". Does the resource support CORS?");
    };
    req.onload = function(evt) {
        loadingProgressText.innerHTML = "Fetched Volume";
        loadingProgressBar.setAttribute("style", "width: 50%");
        var dataBuffer = req.response;
        if (req.status == 200 && dataBuffer) {
            FS.createDataFile("/", "remote_fetch.tiff", new Uint8Array(dataBuffer), true, false);
            var tiff = TIFFOpen("remote_fetch.tiff", "r");

            var numDirectories = 0;
            if (!TIFFLastDirectory(tiff)) {
                do {
                    ++numDirectories;
                } while (TIFFReadDirectory(tiff));
                TIFFSetDirectory(tiff, 0);
            }

            // We only support single channel images
            if (TIFFGetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
                alert("Only single channel images are supported");
            } else if (numDirectories == 0) {
                alert("Only multi-page TIFFs are supported via remote fetch");
            } else {
                var width = TIFFGetField(tiff, TiffTag.IMAGEWIDTH);
                var height = TIFFGetField(tiff, TiffTag.IMAGELENGTH);
                volDims = [width, height, numDirectories];
                document.getElementById("volumeName").innerHTML =
                    "Volume: Multi-page '" + volumeURL + "', " + numDirectories + " pages";

                makeTIFFGLVolume(tiff);

                loadMultipageTiff(tiff, numDirectories);
            }
            TIFFClose(tiff);
            FS.unlink("/remote_fetch.tiff");
        } else {
            alert("Unable to load TIFF from remote URL");
        }
    };
    req.send();
}

// Load up the SWC files the user gave us
var uploadSWC = function() {
    var files = document.getElementById("uploadSWC").files;
    var swcList = document.getElementById("swcList");
    // Javascript is a mess...
    var loadFile = function(i) {
        var file = files[i];
        var reader = new FileReader();
        reader.onerror = function() {
            alert("Error reading file " + file.name);
        };
        reader.onload = function(evt) {
            var text = reader.result;
            if (text) {
                var swc = new SWCTree(text, file.name);
                addSWCFile(swc);
            } else {
                alert("Unable to load file " + file.name);
            }
        };
        reader.readAsText(file);
    };

    for (var i = 0; i < files.length; ++i) {
        loadFile(i);
    }
}

var loadReference = function() {
    var referenceTraces = [
        "NC_01.swc",
        "NC_02.swc",
        "NC_03.swc",
        "NC_04.swc",
        "NC_05.swc",
        "NC_06.swc",
        "NC_07.swc",
        "NC_08.swc",
        "NC_09.swc",
        "NC_10.swc",
        "NC_11.swc",
        "NC_12.swc",
        "NC_13.swc",
        "NC_14.swc",
        "NC_15.swc",
        "NC_16.swc",
        "NC_17.swc",
        "NC_18.swc",
        "NC_19.swc",
        "NC_20.swc",
        "NC_21.swc",
        "NC_22.swc",
        "NC_23.swc",
        "NC_24.swc",
        "NC_25.swc",
        "NC_26.swc",
        "NC_27.swc",
        "NC_28.swc",
        "NC_29.swc",
        "NC_30.swc",
        "NC_31.swc",
        "NC_32.swc",
        "NC_33.swc",
        "NC_34.swc"
    ];
    var swcFileRegex = /(\w+).swc.*/;

    // Javascript is a mess...
    var launcReq = function(i) {
        var file = referenceTraces[i];
        var url = "https://cdn.willusher.io/webgl-neuron-data/" + file;
        var req = new XMLHttpRequest();

        req.open("GET", url, true);
        req.responseType = "text";
        req.onerror = function(evt) {
            alert("Failed to load reference trace from " + url);
        };
        req.onload = function(evt) {
            var text = req.response;
            if (text) {
                var m = req.responseURL.match(swcFileRegex);
                var swc = new SWCTree(text, m[1]);
                addSWCFile(swc);
            } else {
                alert("Unable to load reference trace from " + url);
            }
        };
        req.send();
    };

    for (var i = 0; i < referenceTraces.length; ++i) {
        launcReq(i);
    }
}

var colorBrewerColors = [
    "#a6cee3", "#1f78b4", "#b2df8a", "#33a02c", "#fb9a99",
    "#e31a1c", "#fdbf6f", "#ff7f00", "#cab2d6", "#6a3d9a"
];
/*
var colorBrewerColors = [
    "#66c2a5", "#fc8d62", "#8da0cb", "#e78ac3", "#a6d854",
    "#ffd92f", "#e5c494", "#b3b3b3"
];
*/
var nextSWCColor = 0;

var swcSelectionChanged = function() {
    // Find the two which are selected
    var a = -1;
    var b = -1;
    var warned = false;
    for (var i = 0; i < neurons.length; ++i) {
        if (neurons[i].selected.checked) {
            if (a == -1) {
                a = i;
            } else if (b == -1) {
                b = i;
            } else {
                neurons[i].selected.checked = false;
                if (!warned) {
                    warned = true;
                    alert("Only two neurons can be compared, automatically deselecting others");
                }
            }
        }
    }

    if (a != -1 && b != -1) {
        var diff_segments = computeTreeDifferences(neurons[a], neurons[b]);
        num_diff_segment_vertices = diff_segments.length / 3;

        if (!diff_segments_vao) {
            diff_segments_vao = gl.createVertexArray();
        }
        gl.bindVertexArray(diff_segments_vao);

        if (!diff_segments_vbo) {
            diff_segments_vbo = gl.createBuffer();
        }
        gl.bindBuffer(gl.ARRAY_BUFFER, diff_segments_vbo);
        gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(diff_segments), gl.STATIC_DRAW);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
    } else {
        num_diff_segment_vertices = 0;
    }
}

var addSWCFile = function(swc) {
    var swcHTMLContent = `
        <div class="col-12 mt-2 mb-2" id="swc">
        <div class="row">
            <div class="col-3" style="overflow-wrap:break-word;">
            ${swc.name}
            </div>
            <div class="col-3 text-right" id="numSoma">
            ${swc.numSoma}
            </div>
            <div class="col-3 text-right" id="numBranches">
            ${swc.branches.length}
            </div>
            <div class="col-3 text-right" id="numPoints">
            ${swc.points.length / 3}
            </div>
        </div>
        <div class="form-row">
            <div class="col-3 text-center">
                <input type="checkbox" class="form-check-input" id="traceVisible${neurons.length}">
                <label class="form-check-label" for="traceVisible${neurons.length}">
                Visible</label>
            </div>
            <div class="col-3 text-center">
                <input type="checkbox" class="form-check-input" id="traceSelected${neurons.length}">
                <label class="form-check-label" for="traceSelected${neurons.length}">
                Compare</label>
            </div>
            <div class="col-6 text-center">
                <label for="swcColor${neurons.length}">Color</label>
                <input type="color" class="form-control" value="#ff0000" id="swcColor${neurons.length}">
            </div>
        </div>
        <hr>
        </div>
        `
    swcList.insertAdjacentHTML("beforeend", swcHTMLContent);

    swc.visible = document.getElementById("traceVisible" + neurons.length);
    swc.visible.checked = true;
    swc.selected = document.getElementById("traceSelected" + neurons.length);
    swc.selected.checked = false;
    swc.selected.addEventListener("change", swcSelectionChanged);
    swc.color = document.getElementById("swcColor" + neurons.length);
    swc.color.value = colorBrewerColors[nextSWCColor];
    nextSWCColor = (nextSWCColor + 1) % colorBrewerColors.length;

    neurons.push(swc);
}

