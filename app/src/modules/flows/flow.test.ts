import { FlowRaw, OperationRaw } from '@directus/types';
import { createTestingPinia } from '@pinia/testing';
import { mount } from '@vue/test-utils';
import { beforeEach, describe, expect, test, vi } from 'vitest';
import { reactive, ref } from 'vue';
import { ATTACHMENT_OFFSET, GRID_SIZE } from './constants';
import FlowView from './flow.vue';
import { Tooltip } from '@/__utils__/tooltip';
import type { GlobalMountOptions } from '@/__utils__/types';
import { i18n } from '@/lang';
import { Vector2 } from '@/utils/vector2';

const mockFlows = reactive<FlowRaw[]>([]);
const mockHydrate = vi.fn();

vi.mock('@/api', () => ({
	default: {
		patch: vi.fn(),
		delete: vi.fn(),
		post: vi.fn(),
	},
}));

vi.mock('@/stores/flows', () => ({
	useFlowsStore: () => ({
		flows: mockFlows,
		hydrate: mockHydrate,
	}),
}));

vi.mock('@/stores/license', () => ({
	useLicenseStore: () => ({
		hydrate: vi.fn(),
	}),
}));

vi.mock('@/extensions', async () => {
	const { ref } = await import('vue');

	return {
		useExtensions: () => ({
			operations: ref([{ id: 'log', name: 'Log to Console' }]),
		}),
	};
});

vi.mock('@/composables/use-edits-guard', () => ({
	useEditsGuard: () => ({
		confirmLeave: ref(false),
		leaveTo: ref(null),
	}),
}));

vi.mock('@directus/composables', async (importOriginal) => {
	const actual = await importOriginal<typeof import('@directus/composables')>();

	return {
		...actual,
		useShortcut: vi.fn(),
	};
});

vi.mock('@/router', () => ({
	router: {
		push: vi.fn(),
		replace: vi.fn(),
		resolve: vi.fn(() => ({ path: '/flows' })),
	},
}));

vi.mock('@/utils/unexpected-error', () => ({
	unexpectedError: vi.fn(),
}));

function makeFlow(overrides: Partial<FlowRaw> = {}): FlowRaw {
	return {
		id: 'flow-1',
		name: 'Test Flow',
		icon: 'bolt',
		color: null,
		description: null,
		status: 'active',
		trigger: 'manual',
		accountability: 'all',
		options: null,
		operation: 'op-1',
		date_created: '2026-01-01T00:00:00Z',
		user_created: null,
		folder: null,
		operations: [
			{
				id: 'op-1',
				name: 'Op 1',
				key: 'op_1',
				type: 'log',
				position_x: 19,
				position_y: 1,
				options: {},
				resolve: 'op-2',
				reject: null,
				flow: 'flow-1',
				date_created: '2026-01-01T00:00:00Z',
				user_created: null,
			} as OperationRaw,
			{
				id: 'op-2',
				name: 'Op 2',
				key: 'op_2',
				type: 'log',
				position_x: 37,
				position_y: 1,
				options: {},
				resolve: null,
				reject: null,
				flow: 'flow-1',
				date_created: '2026-01-01T00:00:00Z',
				user_created: null,
			} as OperationRaw,
		],
		...overrides,
	};
}

function panelAttachmentPos(positionX: number, positionY: number): Vector2 {
	return new Vector2(
		(positionX - 1) * GRID_SIZE + ATTACHMENT_OFFSET.x,
		(positionY - 1) * GRID_SIZE + ATTACHMENT_OFFSET.y,
	);
}

let global: GlobalMountOptions;

beforeEach(() => {
	vi.clearAllMocks();
	mockFlows.splice(0, mockFlows.length, makeFlow());

	global = {
		stubs: {
			Arrows: true,
			LogsSidebarDetail: true,
			FlowsNavigation: true,
			Operation: true,
			FlowDrawer: true,
			FlowsNotFound: true,
			PrivateView: true,
			PrivateViewHeaderBarActionButton: true,
			VWorkspace: true,
			VButton: true,
			VCard: true,
			VCardTitle: true,
			VCardText: true,
			VCardActions: true,
			VDialog: true,
			VNotice: true,
			VProgressCircular: true,
			VSelect: true,
			DisplayColor: true,
			RouterView: true,
		},
		plugins: [i18n, createTestingPinia({ createSpy: vi.fn, stubActions: false })],
		directives: {
			tooltip: Tooltip,
		},
	};

	vi.spyOn(i18n.global, 't').mockImplementation((key: string | number) => String(key) as any);
});

describe('Flow - trigger connection edits', () => {
	test('tracks connecting $trigger to an operation and saves only delta in stagedFlow', async () => {
		const api = (await vi.importMock<{ default: { patch: ReturnType<typeof vi.fn> } }>('@/api')).default;
		api.patch.mockResolvedValue({ data: { data: {} } });

		mockFlows.splice(0, mockFlows.length, makeFlow({ operation: null }));
		const wrapper = mount(FlowView, { global, props: { primaryKey: 'flow-1' } });
		const vm = wrapper.vm as any;

		expect(vm.hasEdits).toBe(false);

		vm.arrowMove({
			id: '$trigger',
			type: 'resolve',
			pos: panelAttachmentPos(19, 1),
		});

		vm.arrowStop();

		expect(vm.flow.operation).toBe('op-1');
		expect(vm.stagedFlow).toEqual({ operation: 'op-1' });
		expect(vm.hasEdits).toBe(true);

		await vm.saveChanges();

		expect(api.patch).toHaveBeenCalledWith(
			'/flows/flow-1',
			expect.objectContaining({
				operation: expect.objectContaining({ id: 'op-1', flow: 'flow-1' }),
			}),
		);
	});

	test('disconnecting $trigger clears flow.operation on canvas, sets hasEdits, and patches null', async () => {
		const api = (await vi.importMock<{ default: { patch: ReturnType<typeof vi.fn> } }>('@/api')).default;
		api.patch.mockResolvedValue({ data: { data: {} } });

		const wrapper = mount(FlowView, { global, props: { primaryKey: 'flow-1' } });
		const vm = wrapper.vm as any;

		expect(vm.flow.operation).toBe('op-1');
		expect(vm.hasEdits).toBe(false);

		vm.arrowMove({
			id: '$trigger',
			type: 'resolve',
			pos: new Vector2(2000, 2000),
		});

		vm.arrowStop();

		expect(vm.flow.operation).toBeNull();
		expect(vm.panels.find((panel: any) => panel.id === '$trigger')?.resolve).toBeUndefined();
		expect(vm.stagedFlow).toEqual({ operation: null });
		expect(vm.hasEdits).toBe(true);

		await vm.saveChanges();

		expect(api.patch).toHaveBeenCalledWith('/flows/flow-1', expect.objectContaining({ operation: null }));
	});

	test('reconnecting $trigger back to the saved operation clears stagedFlow.operation and hasEdits', () => {
		const wrapper = mount(FlowView, { global, props: { primaryKey: 'flow-1' } });
		const vm = wrapper.vm as any;

		vm.arrowMove({ id: '$trigger', type: 'resolve', pos: new Vector2(2000, 2000) });
		vm.arrowStop();
		expect(vm.hasEdits).toBe(true);

		vm.arrowMove({ id: '$trigger', type: 'resolve', pos: panelAttachmentPos(19, 1) });
		vm.arrowStop();

		expect(vm.flow.operation).toBe('op-1');
		expect(vm.stagedFlow).toEqual({});
		expect(vm.hasEdits).toBe(false);
	});

	test('deleting the root operation stages operation: null without discarding staged status', async () => {
		const api = (await vi.importMock<{ default: { patch: ReturnType<typeof vi.fn> } }>('@/api')).default;
		api.patch.mockResolvedValue({ data: { data: {} } });

		const wrapper = mount(FlowView, { global, props: { primaryKey: 'flow-1' } });
		const vm = wrapper.vm as any;

		vm.stageStatus('inactive');
		await vm.deletePanel('op-1');

		expect(vm.flow.operation).toBeNull();
		expect(vm.stagedFlow).toEqual({ status: 'inactive', operation: null });
		expect(vm.hasEdits).toBe(true);

		await vm.saveChanges();

		expect(api.patch).toHaveBeenCalledWith(
			'/flows/flow-1',
			expect.objectContaining({ status: 'inactive', operation: null }),
		);
	});
});
