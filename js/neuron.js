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
var showVolume = null;
var volumeThreshold = null;

var loadingProgressText = null;
var loadingProgressBar = null;

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
var fileRegex = /.*\/(\w+)_(\d+)x(\d+)x(\d+)_(\w+)\.*/;
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
    "DIADEM NC Layer 1 Axons": "/04imux1qxpkilix/neocortical_layer_1_axons_1464x1033x76_uint8.raw",
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

var loadRAWVolume = function(file, onload) {
    // Only one raw volume here anyway
    document.getElementById("volumeName").innerHTML = "Volume: DIADEM NC Layer 1 Axons";

    var m = file.match(fileRegex);
    volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];

    var url = "https://www.dl.dropboxusercontent.com/s/" + file + "?dl=1";
    var req = new XMLHttpRequest();

    loadingProgressText.innerHTML = "Loading Volume";
    loadingProgressBar.setAttribute("style", "width: 0%");

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
        camera = new ArcballCamera(defaultEye, center, up, 2, [WIDTH, HEIGHT]);
        samplingRate = 1.0;
        shader.use(gl);
        gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
    }

    var startTime = new Date();

    projView = mat4.mul(projView, proj, camera.camera);
    var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];

    var longestAxis = Math.max(volDims[0], Math.max(volDims[1], volDims[2]));
    var volScale = [volDims[0] / longestAxis, volDims[1] / longestAxis,
        volDims[2] / longestAxis];

    // Render any SWC files we have
    gl.bindFramebuffer(gl.FRAMEBUFFER, depthColorFbo);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.enable(gl.DEPTH_TEST);
    if (neurons.length > 0) {
        swcShader.use(gl);
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
    var endTime = new Date();
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
    showVolume = document.getElementById("showVolume");
    showVolume.checked = true;

    volumeThreshold = document.getElementById("threshold");
    volumeThreshold.value = 0.1;

    loadingProgressText = document.getElementById("loadingText");
    loadingProgressBar = document.getElementById("loadingProgressBar");

    canvas = document.getElementById("glcanvas");

    // For some random JS/HTML reason it won't find the function if it's not set here
    document.getElementById("fetchTIFFButton").onclick = fetchTIFF;

    var volumeURL = null;
    if (window.location.hash) {
        var regexResolution = /(\d+)x(\d+)/;
        var urlParams = window.location.hash.substr(1).split("&");
        for (var i = 0; i < urlParams.length; ++i) {
            var str = decodeURI(urlParams[i]);
            if (str.startsWith("url=")) {
                volumeURL = str.substr(4);
                continue;
            }

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
        WIDTH / HEIGHT, 0.1, 100);
    invProj = mat4.invert(mat4.create(), proj);

    camera = new ArcballCamera(defaultEye, center, up, 2, [WIDTH, HEIGHT]);
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

    gl.clearColor(0.1, 0.1, 0.1, 1.0);
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
        gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, 180, 1);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texSubImage2D(gl.TEXTURE_2D, 0, 0, 0, 180, 1,
            gl.RGBA, gl.UNSIGNED_BYTE, colormapImage);


        if (volumeURL) {
            fetchTIFFURL(volumeURL);
        } else {
            loadRAWVolume(volumes["DIADEM NC Layer 1 Axons"]);
        }
        setInterval(renderLoop, targetFrameTime);
    };
    colormapImage.src = "colormaps/grayscale.png";
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
    var imgFormat = GetField(tiff, TiffTag.SAMPLEFORMAT);
    var bytesPerSample = GetField(tiff, TiffTag.BITSPERSAMPLE) / 8;
    var width = GetField(tiff, TiffTag.IMAGEWIDTH);
    var height = GetField(tiff, TiffTag.IMAGELENGTH);

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

var loadTIFFSlice = function(tiff, z_index) {
    var bps = GetField(tiff, TiffTag.BITSPERSAMPLE);

    // We only support single channel images
    if (GetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
        alert("Only single channel images are supported");
        return;
    }

    var imgFormat = GetField(tiff, TiffTag.SAMPLEFORMAT);

    var width = GetField(tiff, TiffTag.IMAGEWIDTH);
    var height = GetField(tiff, TiffTag.IMAGELENGTH);

    var numStrips = TIFFNumberOfStrips(tiff);
    var rowsPerStrip = GetField(tiff, TiffTag.ROWSPERSTRIP);

    var bytesPerSample = GetField(tiff, TiffTag.BITSPERSAMPLE) / 8;

    var img = new Uint8Array(width * height * bytesPerSample);
    var sbuf = TIFFMalloc(TIFFStripSize(tiff));
    for (var s = 0; s < numStrips; ++s) {
        var read = TIFFReadEncodedStrip(tiff, s, sbuf, -1);
        if (read == -1) {
            alert("Error reading encoded strip from TIFF file " + file);
        }
        // Just make a view into the heap, not a copy
        var stripData = new Uint8Array(Module.HEAPU8.buffer, sbuf, read);
        img.set(stripData, s * rowsPerStrip * width * bytesPerSample);
    }
    TIFFFree(sbuf);

    // Flip the image in Y, since TIFF y axis is downwards
    for (var y = 0; y < height / 2; ++y) {
        for (var x = 0; x < width; ++x) {
            for (var b = 0; b < bytesPerSample; ++b) {
                var tmp = img[(y * width + x) * bytesPerSample];
                img[(y * width + x) * bytesPerSample] =
                    img[((height - y - 1) * width + x) * bytesPerSample];
                img[((height - y - 1) * width + x) * bytesPerSample] = tmp;
            }
        }
    }

    var glFormat = TIFFGLFormat(imgFormat, bytesPerSample);
    if (glFormat == gl.R8) {
        gl.activeTexture(gl.TEXTURE0);
        gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
        gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, z_index,
            width, height, 1, gl.RED, gl.UNSIGNED_BYTE, img);
    } else {
        gl.activeTexture(gl.TEXTURE5);
        gl.bindTexture(gl.TEXTURE_3D, volumeTexture);
        var u16arr = new Uint16Array(img.buffer);
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
    for (var i = 0; i < numDirectories; ++i) {
        loadTIFFSlice(tiff, i);
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
    var numLoaded = 0;
    volumeLoaded = false;

    loadingProgressText.innerHTML = "Loading Volume";
    loadingProgressBar.setAttribute("style", "width: 0%");

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

                loadTIFFSlice(tiff, i);

                TIFFClose(tiff);
                FS.unlink("/" + fname);

                numLoaded += 1;
                if (numLoaded == files.length) {
                    volumeLoaded = true;
                    newVolumeUpload = true;
                    loadingProgressText.innerHTML = "Loaded Volume";
                    loadingProgressBar.setAttribute("style", "width: 101%");
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
            if (GetField(tiff, TiffTag.SUBFILETYPE) == 2) {
                do {
                    ++numDirectories;
                } while (TIFFReadDirectory(tiff));
                TIFFSetDirectory(tiff, 0);
            }

            // We only support single channel images
            if (GetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
                alert("Only single channel images are supported");
                return;
            }

            var width = GetField(tiff, TiffTag.IMAGEWIDTH);
            var height = GetField(tiff, TiffTag.IMAGELENGTH);
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
    var url = document.getElementById("fetchTIFF").value;
    fetchTIFFURL(url);
}

var fetchTIFFURL = function(url) {
    volumeLoaded = false;

    // Users will paste the shared URL from dropbox if they use that,
    // so we need to change it to the direct URL to fetch from
    var dropboxRegex = /.*dropbox.com\/s\/([^?]+)/
    var m = url.match(dropboxRegex);
    if (m) {
        url = "https://www.dl.dropboxusercontent.com/s/" + m[1] + "?dl=1";
    }
    window.location.hash = "#url=" + url;
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
            if (GetField(tiff, TiffTag.SUBFILETYPE) == 2) {
                do {
                    ++numDirectories;
                } while (TIFFReadDirectory(tiff));
                TIFFSetDirectory(tiff, 0);
            }

            // We only support single channel images
            if (GetField(tiff, TiffTag.SAMPLESPERPIXEL) != 1) {
                alert("Only single channel images are supported");
                return;
            }

            if (numDirectories == 0) {
                alert("Only multi-page TIFFs are supported via remote fetch");
            }

            var width = GetField(tiff, TiffTag.IMAGEWIDTH);
            var height = GetField(tiff, TiffTag.IMAGELENGTH);
            volDims = [width, height, numDirectories];
            document.getElementById("volumeName").innerHTML =
                "Volume: Multi-page '" + url + "', " + numDirectories + " pages";

            makeTIFFGLVolume(tiff);

            loadMultipageTiff(tiff, numDirectories);
            TIFFClose(tiff);
            FS.unlink("/remote_fetch.tiff");
        } else {
            alert("Unable to load TIFF from remote URL");
        }
    };
    req.send();
}

// Load up the SWC files the user gave us
var uploadSWC = function(files) {
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
        "eoi1v4ljg57rxqi/NC_01.swc",
        "bfiyjwh5yn1p0za/NC_02.swc",
        "vwjwesnrbgr4tjj/NC_03.swc",
        "jeufs20oc5yzvub/NC_04.swc",
        "2ys0gk8635x9yt2/NC_05.swc",
        "4xmm305jakor382/NC_06.swc",
        "3o0fhvzfybpsp5z/NC_07.swc",
        "hyhi1xav9ezvug8/NC_08.swc",
        "yzko7oe1tn9p1ii/NC_09.swc",
        "cs6er8399zmyezs/NC_10.swc",
        "b7heei13tcmgzos/NC_11.swc",
        "o0cw7b80xrvhnl3/NC_12.swc",
        "fou5gezumjh704r/NC_13.swc",
        "3xtb473tw9muhao/NC_14.swc",
        "vegtbrhiesddmoc/NC_15.swc",
        "e6qu43lxc0orrgi/NC_16.swc",
        "se22spz51ocuwdm/NC_17.swc",
        "rq129kxph1yqba3/NC_18.swc",
        "0hqhfpovfjoitgg/NC_19.swc",
        "ruxexsh7x5u5ue7/NC_20.swc",
        "74bmqgoup2pejq3/NC_21.swc",
        "yguszsopbyektdk/NC_22.swc",
        "h1n9ecdr2v6x3qn/NC_23.swc",
        "cnytvpzk4unva2f/NC_24.swc",
        "g4hv06u5zuuhp4p/NC_25.swc",
        "p71x8ic7fhdpry6/NC_26.swc",
        "6r547xn8ohos6i4/NC_27.swc",
        "s1sbs0ktmjq1gcj/NC_28.swc",
        "q1w8m5nba9lafps/NC_29.swc",
        "t3t9f1m61xe5dn2/NC_30.swc",
        "smqs2reslrhwnh5/NC_31.swc",
        "uj292uu3jjlmnn4/NC_32.swc",
        "laq2jhdi4iytd9e/NC_33.swc",
        "ml2cojmc7dz8tpy/NC_34.swc"
    ];
    var swcFileRegex = /.*\/(\w+).swc.*/;

    // Javascript is a mess...
    var launcReq = function(i) {
        var file = referenceTraces[i];
        var url = "https://www.dl.dropboxusercontent.com/s/" + file + "?dl=1";
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
        <div class="col-6 text-center">
        <input type="checkbox" class="form-check-input"
    id="traceVisible${neurons.length}">
        <label class="form-check-label" for="traceVisible${neurons.length}">
        Visible</label>
        </div>
        <div class="col-6 text-center">
        <label for="swcColor${neurons.length}">Color</label>
        <input type="color" class="form-control" value="#ff0000"
    id="swcColor${neurons.length}">
        </div>
        </div>
        <hr>
        </div>
        `
    swcList.insertAdjacentHTML("beforeend", swcHTMLContent);

    swc.visible = document.getElementById("traceVisible" + neurons.length);
    swc.visible.checked = true;
    swc.color = document.getElementById("swcColor" + neurons.length);
    swc.color.value = colorBrewerColors[nextSWCColor];
    nextSWCColor = (nextSWCColor + 1) % colorBrewerColors.length;

    neurons.push(swc);
}

