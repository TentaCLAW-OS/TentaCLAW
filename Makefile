# TentaCLAW OS — Makefile
# Easy build targets for common operations

.PHONY: all iso pxe agent gateway cli help clean distclean deps dev demo

VERSION ?= 0.1.0
ARCH ?= amd64

all: agent gateway cli

# === Build Targets ===

iso:
	@echo "Building TentaCLAW OS ISO..."
	@cd builder && bash build-iso.sh --version $(VERSION) --arch $(ARCH)

pxe:
	@echo "Building PXE artifacts..."
	@cd builder && bash build-pxe.sh --version $(VERSION) --arch $(ARCH)

agent:
	@echo "Building TentaCLAW Agent..."
	@cd agent && npm install && npm run build

gateway:
	@echo "Building TentaCLAW HiveMind Gateway..."
	@cd gateway && npm install && npm run build

cli:
	@echo "Building TentaCLAW CLI..."
	@cd cli && npm install && npm run build

# === Dev Mode ===

agent-dev:
	@cd agent && npm run dev

gateway-dev:
	@cd gateway && npm run dev

# Run mock agent (generates fake GPU stats, works on any OS)
agent-mock:
	@cd agent && npx tsx src/index.ts --mock --gateway http://localhost:8080

# Run a second mock node
agent-mock-2:
	@cd agent && npx tsx src/index.ts --mock --name gpu-rig-02 --gpus 4 --gateway http://localhost:8080

# Spawn a swarm of mock nodes (default 4, set NODES=8 for more)
NODES ?= 4
swarm:
	@cd agent && npx tsx src/spawner.ts --nodes $(NODES) --gateway http://localhost:8080

# Full dev stack: gateway + 2 mock agents (run in separate terminals)
dev:
	@echo "TentaCLAW Development Stack"
	@echo ""
	@echo "Run these in separate terminals:"
	@echo ""
	@echo "  Terminal 1: make gateway-dev"
	@echo "  Terminal 2: make agent-mock"
	@echo "  Terminal 3: make agent-mock-2  (optional)"
	@echo ""
	@echo "Then open: http://localhost:8080/dashboard"
	@echo ""

# Setup (one-command dev environment)
setup:
	@bash setup.sh

# === Tests ===

agent-test:
	@cd agent && npm test

gateway-test:
	@cd gateway && npm test

# Test boot chain with mock data (no ISO needed)
test-boot:
	@bash builder/test-boot-chain.sh

# Boot ISO in QEMU
test-qemu:
	@bash builder/test-qemu.sh

test: agent-test gateway-test

test-iso:
	@echo "Testing ISO in QEMU..."
	@which qemu-system-x86_64 > /dev/null 2>&1 || { echo "QEMU not found. Install with: apt-get install qemu-system-x86"; exit 1; }
	@qemu-system-x86_64 -m 2048 -cdrom iso/TentaCLAW-OS-$(VERSION)-$(ARCH).iso -boot d

# === Cleanup ===

clean:
	rm -rf iso pxe
	rm -rf agent/dist agent/node_modules
	rm -rf gateway/dist gateway/node_modules gateway/data
	rm -rf cli/dist cli/node_modules

distclean: clean
	rm -rf /tmp/tentaclaw-*

# === Dependencies ===

deps:
	apt-get update && apt-get install -y \
		debootstrap xorriso grub-pc-bin grub-efi-amd64-bin grub-efi-arm64-bin \
		mtools squashfs-tools gzip cpio wget jq uuid-runtime dosfstools

node-deps:
	@cd agent && npm install
	@cd gateway && npm install
	@cd cli && npm install

# === Help ===

help:
	@echo "TentaCLAW OS — Build Targets"
	@echo ""
	@echo "  Build:"
	@echo "    make all             Build agent + gateway + cli"
	@echo "    make iso             Build the bootable ISO"
	@echo "    make agent           Build the TentaCLAW Agent"
	@echo "    make gateway         Build the HiveMind Gateway"
	@echo "    make cli             Build the CLI tool"
	@echo ""
	@echo "  Development:"
	@echo "    make dev             Show dev stack instructions"
	@echo "    make gateway-dev     Run gateway (hot reload)"
	@echo "    make agent-mock      Run mock agent (fake GPUs)"
	@echo "    make agent-mock-2    Run second mock agent"
	@echo "    make swarm           Spawn 4 mock nodes (NODES=8 for more)"
	@echo ""
	@echo "  Testing:"
	@echo "    make test            Run all tests"
	@echo "    make test-iso        Test ISO in QEMU"
	@echo ""
	@echo "  Quick Start:"
	@echo "    make node-deps"
	@echo "    make gateway-dev     # terminal 1"
	@echo "    make agent-mock      # terminal 2"
	@echo "    # open http://localhost:8080/dashboard"
	@echo ""
