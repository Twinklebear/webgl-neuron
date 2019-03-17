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

var swc = null;
var swcVbo = null;
var swcEbo = null;
var swcVao = null;
var swcShader = null;

var renderTargets = null;
var fbo = null
var blitImageShader = null;

var shader = null;
var volumeTexture = null;
var volumeVao = null;
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
const center = vec3.set(vec3.create(), 0.5, 0.5, 0.5);

var volumes = {
	"DIADEM NC Layer 1 Axons": "/04imux1qxpkilix/neocortical_layer_1_axons_1464x1033x76_uint8.raw",
};

var colormaps = {
	"Cool Warm": "colormaps/cool-warm-paraview.png",
	"Matplotlib Plasma": "colormaps/matplotlib-plasma.png",
	"Matplotlib Virdis": "colormaps/matplotlib-virdis.png",
	"Rainbow": "colormaps/rainbow.png",
	"Samsel Linear Green": "colormaps/samsel-linear-green.png",
	"Samsel Linear YGB 1211G": "colormaps/samsel-linear-ygb-1211g.png",
};

var loadVolume = function(file, onload) {
	var m = file.match(fileRegex);
	var volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];
	
	var url = "https://www.dl.dropboxusercontent.com/s/" + file + "?dl=1";
	var req = new XMLHttpRequest();
	var loadingProgressText = document.getElementById("loadingText");
	var loadingProgressBar = document.getElementById("loadingProgressBar");

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
		loadingProgressBar.setAttribute("style", "width: 100%");
		var dataBuffer = req.response;
		if (dataBuffer) {
			dataBuffer = new Uint8Array(dataBuffer);
			onload(file, dataBuffer);
		} else {
			alert("Unable to load buffer properly from volume?");
			console.log("no buffer?");
		}
	};
	req.send();
}

var selectVolume = function() {
	var selection = document.getElementById("volumeList").value;
	history.replaceState(history.state, "#" + selection, "#" + selection);

	var url = "./diadem_nc_03.swc";
	var req = new XMLHttpRequest();
	req.open("GET", url, true);
	req.responseType = "text";
	req.onload = function(evt) {
		var text = req.response;
		if (text) {
			swc = new SWCTree(text);
		} else {
			alert("Unable to load text from SWC");
			console.log("no buffer?");
		}
	};
	req.send();

	loadVolume(volumes[selection], function(file, dataBuffer) {
		var m = file.match(fileRegex);
		var volDims = [parseInt(m[2]), parseInt(m[3]), parseInt(m[4])];

		var tex = gl.createTexture();
		gl.activeTexture(gl.TEXTURE0);
		gl.bindTexture(gl.TEXTURE_3D, tex);
		gl.texStorage3D(gl.TEXTURE_3D, 1, gl.R8, volDims[0], volDims[1], volDims[2]);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
		gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
		gl.texSubImage3D(gl.TEXTURE_3D, 0, 0, 0, 0,
			volDims[0], volDims[1], volDims[2],
			gl.RED, gl.UNSIGNED_BYTE, dataBuffer);

		var longestAxis = Math.max(volDims[0], Math.max(volDims[1], volDims[2]));
		var volScale = [volDims[0] / longestAxis, volDims[1] / longestAxis,
			volDims[2] / longestAxis];

		gl.uniform3iv(shader.uniforms["volume_dims"], volDims);
		gl.uniform3fv(shader.uniforms["volume_scale"], volScale);

		newVolumeUpload = true;
		if (!volumeTexture) {
			volumeTexture = tex;
			setInterval(function() {
				// Save them some battery if they're not viewing the tab
				if (document.hidden) {
					return;
				}

				// Reset the sampling rate and camera for new volumes
				if (newVolumeUpload) {
					camera = new ArcballCamera(center, 2, [WIDTH, HEIGHT]);
					samplingRate = 1.0;
					gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
				}

				// We got a new SWC file, so upload it to the GPU
				if (swc != null && swcVbo == null) {
					swcVao = gl.createVertexArray();
					gl.bindVertexArray(swcVao);

					swcVbo = gl.createBuffer();
					gl.bindBuffer(gl.ARRAY_BUFFER, swcVbo);
					gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(swc.points), gl.STATIC_DRAW);
					gl.enableVertexAttribArray(0);
					gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);

					swcEbo = gl.createBuffer();
					gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, swcEbo);
					gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, new Uint16Array(swc.indices), gl.STATIC_DRAW);
				}

				var startTime = new Date();

				projView = mat4.mul(projView, proj, camera.camera);
				var eye = [camera.invCamera[12], camera.invCamera[13], camera.invCamera[14]];

				//gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
				gl.clearColor(0.0, 0.0, 0.0, 0.0);
				gl.clearDepth(1.0);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
				if (swc) {
					gl.enable(gl.DEPTH_TEST);
					swcShader.use();
					gl.uniform3iv(swcShader.uniforms["volume_dims"], volDims);
					gl.uniform3fv(swcShader.uniforms["volume_scale"], volScale);
					gl.uniformMatrix4fv(swcShader.uniforms["proj_view"], false, projView);

					gl.bindVertexArray(swcVao);
					for (var i = 0; i < swc.branches.length; ++i) {
						var b = swc.branches[i];
						gl.drawElements(gl.LINE_STRIP, b["count"], gl.UNSIGNED_SHORT, 2 * b["start"]);
					}
				}

				//gl.disable(gl.DEPTH_TEST);
				shader.use();
				gl.uniformMatrix4fv(shader.uniforms["proj_view"], false, projView);
				//gl.uniformMatrix4fv(shader.uniforms["inv_proj"], false, invProj);
				gl.uniform3fv(shader.uniforms["eye_pos"], eye);

				gl.bindVertexArray(volumeVao);
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, cubeStrip.length / 3);

				// Seems like we can't blit the framebuffer b/c the default draw fbo might be
				// using multiple samples?
				/*
				gl.bindFramebuffer(gl.FRAMEBUFFER, null);
				gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
				gl.disable(gl.DEPTH_TEST);
				gl.disable(gl.BLEND);
				gl.disable(gl.CULL_FACE);
				blitImageShader.use();
				gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
				*/
				gl.enable(gl.CULL_FACE);
				gl.enable(gl.BLEND);

				// Wait for rendering to actually finish
				gl.finish();
				var endTime = new Date();
				var renderTime = endTime - startTime;
				var targetSamplingRate = renderTime / targetFrameTime;

				// If we're dropping frames, decrease the sampling rate
				if (!newVolumeUpload && targetSamplingRate > samplingRate) {
					samplingRate = 0.5 * samplingRate + 0.5 * targetSamplingRate;
					gl.uniform1f(shader.uniforms["dt_scale"], samplingRate);
				}
				newVolumeUpload = false;
				startTime = endTime;
			}, targetFrameTime);
		} else {
			gl.deleteTexture(volumeTexture);
			volumeTexture = tex;
		}
	});
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

window.onload = function(){
	fillVolumeSelector();
	fillcolormapSelector();

	var canvas = document.getElementById("glcanvas");
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

	camera = new ArcballCamera(center, 2, [WIDTH, HEIGHT]);
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

	blitImageShader = new Shader(quadVertShader, quadFragShader);
	swcShader = new Shader(swcVertShader, swcFragShader);

	shader = new Shader(vertShader, fragShader);
	shader.use();

	gl.uniform1i(shader.uniforms["volume"], 0);
	gl.uniform1i(shader.uniforms["colormap"], 1);
	gl.uniform1f(shader.uniforms["dt_scale"], 1.0);

	// Setup required OpenGL state for drawing the back faces and
	// composting with the background color
	gl.enable(gl.CULL_FACE);
	gl.cullFace(gl.FRONT);
	gl.enable(gl.BLEND);
	gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

	gl.clearColor(0.0, 0.0, 0.0, 0.0);
	gl.clearDepth(1.0);

	// Setup the render targets for the splat rendering pass
	/*
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

	gl.activeTexture(gl.TEXTURE1);
	gl.bindTexture(gl.TEXTURE_2D, renderTargets[1]);

	fbo = gl.createFramebuffer();
	gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0,
		gl.TEXTURE_2D, renderTargets[0], 0);
	gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT,
		gl.TEXTURE_2D, renderTargets[1], 0);
	gl.drawBuffers([gl.COLOR_ATTACHMENT0]);
	*/

	// See if we were linked to a datset
	if (window.location.hash) {
		var linkedDataset = decodeURI(window.location.hash.substr(1));
		if (linkedDataset in volumes) {
			document.getElementById("volumeList").value = linkedDataset;
		}
	}

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

		selectVolume();
	};
	colormapImage.src = "colormaps/cool-warm-paraview.png";
}

var fillVolumeSelector = function() {
	var selector = document.getElementById("volumeList");
	for (v in volumes) {
		var opt = document.createElement("option");
		opt.value = v;
		opt.innerHTML = v;
		selector.appendChild(opt);
	}
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

