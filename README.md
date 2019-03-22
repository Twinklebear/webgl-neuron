# WebGL Neuron Viewer

A neuron visualization system in WebGL, [try it out online!](https://www.willusher.io/webgl-neuron/)
The volume data
is rendered using my [WebGL volume raycaster](https://github.com/Twinklebear/webgl-volume-raycaster/).
Neuron traces can be uploaded in the [SWC](http://research.mssm.edu/cnic/swc.html) file format.
It can also load single-channel 8 or 16bit unsigned int TIFF images, if you want to try
it on your own data.

Uses [webgl-util](https://github.com/Twinklebear/webgl-util) for some WebGL
utilities, [glMatrix](http://glmatrix.net/) for matrix/vector operations,
and my fork of [tiff.js](https://github.com/Twinklebear/tiff.js) to load TIFF images.

## Images

Displaying the [DIADEM NC Layer 1 Axons](http://diademchallenge.org/neocortical_layer_1_axons_readme.html)
dataset and the provided reference traces, courtesy De Paola et al. 2006,
from the [DIADEM Challenge](http://diademchallenge.org/).

![DIADEM NC Layer 1](https://i.imgur.com/9vVRCLE.png)

The Marmoset neurons are the 16bit TIFF stack version of the dataset available
on [OpenScivisDatasets](http://sci.utah.edu/~klacansky/cdn/open-scivis-datasets/marmoset_neurons/),
courtesy of Fred Federer and Alessandra Angelucci.

![Marmoset](https://i.imgur.com/lwlbLCw.png)

