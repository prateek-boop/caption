# Troubleshooting cuDNN Loading Errors

This guide helps resolve common cuDNN-related errors when running on GPU. These issues typically occur when the system can't locate cuDNN libraries or finds conflicting versions.

## Unable to Load cuDNN Libraries

If you encounter the following error:

`Unable to load any of {libcudnn_cnn.so.9.1.0, libcudnn_cnn.so.9.1, libcudnn_cnn.so.9, libcudnn_cnn.so}`

This means the cuDNN libraries are installed but aren't in a location where the system's dynamic linker can find them.

### Solution 1: Add to LD_LIBRARY_PATH (Recommended)

Add this at the start of your Python script or notebook:

```python
import os

# Get current LD_LIBRARY_PATH
original = os.environ.get("LD_LIBRARY_PATH", "")

cudnn_path = "/usr/local/lib/python3.10/dist-packages/nvidia/cudnn/lib/"
os.environ['LD_LIBRARY_PATH'] = original + ":" + cudnn_path
```

### Solution 2: Symlink to LD_LIBRARY_PATH Directory

If Solution 1 didn't work and you still get the "unable to load" error, symlink the libraries to a directory that's already in your `LD_LIBRARY_PATH`:

1. Check what's in your LD_LIBRARY_PATH: `echo "$LD_LIBRARY_PATH"`
2. Symlink the downloaded libcudnn files to that path:
   `ln -s /usr/local/lib/python3.10/dist-packages/nvidia/cudnn/lib/libcudnn* "$LD_LIBRARY_PATH"/`

## cuDNN Version Incompatibility

If you encounter this error:

```
RuntimeError: cuDNN version incompatibility: PyTorch was compiled against (9, 10, 2) but found runtime version (9, 2, 1)
```

This means PyTorch is finding a different cuDNN version than the one it was compiled with.

### Solution: Clear LD_LIBRARY_PATH

```python
import os
# Let PyTorch use its bundled cuDNN
os.environ.pop('LD_LIBRARY_PATH', None)
```
